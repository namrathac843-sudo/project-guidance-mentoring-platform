"""
Mentoring-session endpoints.

GET    /api/sessions                list (role-filtered)
POST   /api/sessions                create
GET    /api/sessions/<id>
PUT    /api/sessions/<id>           reschedule / edit
DELETE /api/sessions/<id>           cancel (soft) or delete
POST   /api/sessions/<id>/cancel    explicit cancel

IMPORTANT
---------
This module does NOT create Google Meet or Zoom rooms. That requires
the official Google Calendar / Zoom APIs and OAuth credentials, which
are out of scope here. The mentor supplies the meeting URL manually
and we validate + store it. The UI opens it in a new browser tab.
"""

from datetime import datetime

from flask import Blueprint, g, request

from .utils import (
    DB, add_notification, err, log_activity, new_id, now_iso, ok,
    require_auth, require_roles, _lock,
)

sessions_bp = Blueprint("sessions", __name__, url_prefix="/api/sessions")

PLATFORMS = ["Google Meet", "Zoom", "Other"]

# Domains we accept for each platform choice.
PLATFORM_DOMAINS = {
    "Google Meet": ("meet.google.com",),
    "Zoom": ("zoom.us", "zoom.com"),
    "Other": None,   # any https URL
}


# ---------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------

def _validate_meeting_url(platform, url):
    if not url:
        return False, "A meeting URL is required."
    if not url.lower().startswith("https://"):
        return False, "The meeting URL must start with https:// for security."

    allowed = PLATFORM_DOMAINS.get(platform)
    if allowed:
        host = url.split("//", 1)[-1].split("/", 1)[0].lower()
        # strip a port if present
        host = host.split(":")[0]
        if not any(host == d or host.endswith("." + d) for d in allowed):
            return False, (
                f"That URL does not look like a {platform} link. "
                f"Expected a domain such as {allowed[0]}."
            )
    return True, ""


def _parse_dt(date_str, time_str):
    """Combine a yyyy-mm-dd and HH:MM into a datetime, or raise ValueError."""
    return datetime.strptime(f"{date_str} {time_str}", "%Y-%m-%d %H:%M")


def _can_manage(user, session):
    return (
        user["role"] == "admin"
        or session.get("mentorId") == user["id"]
    )


def _can_see(user, session):
    if user["role"] == "admin":
        return True
    if session.get("mentorId") == user["id"]:
        return True
    if session.get("studentId") == user["id"]:
        return True
    return False


# ---------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------

@sessions_bp.get("")
@require_auth
def list_sessions():
    user = g.user
    all_sessions = list(DB["sessions"].values())

    if user["role"] == "admin":
        visible = all_sessions
    else:
        visible = [s for s in all_sessions if _can_see(user, s)]

    status = request.args.get("status")
    if status:
        visible = [s for s in visible if s.get("status") == status]

    scope = request.args.get("scope")   # upcoming | past
    today = datetime.utcnow().strftime("%Y-%m-%d")
    if scope == "upcoming":
        visible = [s for s in visible if s.get("date", "") >= today
                   and s.get("status") == "Scheduled"]
    elif scope == "past":
        visible = [s for s in visible if s.get("date", "") < today
                   or s.get("status") in ("Completed", "Cancelled")]

    visible.sort(key=lambda s: (s.get("date", ""), s.get("startTime", "")))
    return ok({"sessions": visible, "count": len(visible)})


@sessions_bp.post("")
@require_roles("lecturer", "alumni", "admin")
def create_session():
    data = request.get_json(silent=True) or {}

    required = ["title", "studentId", "date", "startTime", "endTime",
                "platform", "meetingUrl"]
    missing = [f for f in required if not str(data.get(f) or "").strip()]
    if missing:
        return err("Missing required fields: " + ", ".join(missing))

    student = DB["users"].get(data["studentId"])
    if not student:
        return err("The selected student does not exist.", 404)

    if data["platform"] not in PLATFORMS:
        return err("Platform must be one of: " + ", ".join(PLATFORMS))

    ok_url, url_msg = _validate_meeting_url(data["platform"], data["meetingUrl"])
    if not ok_url:
        return err(url_msg)

    try:
        start_dt = _parse_dt(data["date"], data["startTime"])
        end_dt = _parse_dt(data["date"], data["endTime"])
    except ValueError:
        return err("Invalid date or time. Use YYYY-MM-DD and HH:MM (24-hour).")

    if end_dt <= start_dt:
        return err("The end time must be later than the start time.")

    mentor_id = data.get("mentorId") or g.user["id"]
    if g.user["role"] != "admin" and mentor_id != g.user["id"]:
        return err("You can only create sessions as yourself.", 403)

    mentor = DB["users"].get(mentor_id)
    if not mentor:
        return err("Mentor account not found.", 404)

    session = {
        "id": new_id("sess"),
        "title": data["title"].strip(),
        "description": data.get("description", "").strip(),
        "mentorId": mentor_id,
        "mentorName": mentor["fullName"],
        "studentId": student["id"],
        "studentName": student["fullName"],
        "projectId": data.get("projectId") or "",
        "date": data["date"],
        "startTime": data["startTime"],
        "endTime": data["endTime"],
        "platform": data["platform"],
        "meetingUrl": data["meetingUrl"].strip(),
        "instructions": data.get("instructions", "").strip(),
        "status": "Scheduled",
        "createdAt": now_iso(),
        "updatedAt": now_iso(),
    }

    with _lock:
        DB["sessions"][session["id"]] = session

    log_activity(mentor_id, "scheduled session", session["title"])

    add_notification(
        student["id"], "session",
        "New mentoring session scheduled",
        f"{mentor['fullName']} scheduled '{session['title']}' on "
        f"{session['date']} at {session['startTime']}.",
        link="mentoring-sessions.html",
        meta={"sessionId": session["id"]},
    )

    return ok({"session": session, "message": "Session created."}), 201


@sessions_bp.get("/<session_id>")
@require_auth
def get_session(session_id):
    session = DB["sessions"].get(session_id)
    if not session:
        return err("Session not found.", 404)
    if not _can_see(g.user, session):
        return err("You are not allowed to view this session.", 403)
    return ok({"session": session})


@sessions_bp.put("/<session_id>")
@require_auth
def update_session(session_id):
    session = DB["sessions"].get(session_id)
    if not session:
        return err("Session not found.", 404)
    if not _can_manage(g.user, session):
        return err("You are not allowed to edit this session.", 403)

    data = request.get_json(silent=True) or {}

    # --- Validate date/time as a pair ------------------------------
    new_date = data.get("date", session["date"])
    new_start = data.get("startTime", session["startTime"])
    new_end = data.get("endTime", session["endTime"])

    try:
        start_dt = _parse_dt(new_date, new_start)
        end_dt = _parse_dt(new_date, new_end)
    except ValueError:
        return err("Invalid date or time. Use YYYY-MM-DD and HH:MM (24-hour).")

    if end_dt <= start_dt:
        return err("The end time must be later than the start time.")

    # --- Validate meeting URL if it is changing ---------------------
    new_platform = data.get("platform", session["platform"])
    new_url = data.get("meetingUrl", session["meetingUrl"])
    ok_url, url_msg = _validate_meeting_url(new_platform, new_url)
    if not ok_url:
        return err(url_msg)

    # Track whether the schedule actually moved.
    rescheduled = (new_date != session["date"]
                   or new_start != session["startTime"]
                   or new_end != session["endTime"])

    editable = {
        "title", "description", "date", "startTime", "endTime",
        "platform", "meetingUrl", "instructions", "projectId", "status",
    }
    with _lock:
        for key, value in data.items():
            if key in editable:
                session[key] = value
        session["mentorName"] = DB["users"].get(session["mentorId"], {}).get(
            "fullName", session["mentorName"]
        )
        session["updatedAt"] = now_iso()

    log_activity(g.user["id"], "updated session", session["title"])

    add_notification(
        session["studentId"], "session",
        "Session rescheduled" if rescheduled else "Session updated",
        f"'{session['title']}' is now on {session['date']} "
        f"from {session['startTime']} to {session['endTime']}.",
        link="mentoring-sessions.html",
        meta={"sessionId": session["id"]},
    )

    return ok({
        "session": session,
        "message": "Session rescheduled." if rescheduled else "Session updated.",
    })


@sessions_bp.post("/<session_id>/cancel")
@require_auth
def cancel_session(session_id):
    session = DB["sessions"].get(session_id)
    if not session:
        return err("Session not found.", 404)
    if not _can_manage(g.user, session):
        return err("You are not allowed to cancel this session.", 403)

    if session["status"] == "Cancelled":
        return err("This session is already cancelled.", 409)

    data = request.get_json(silent=True) or {}
    reason = (data.get("reason") or "").strip()

    with _lock:
        session["status"] = "Cancelled"
        session["cancelReason"] = reason
        session["updatedAt"] = now_iso()

    log_activity(g.user["id"], "cancelled session", session["title"])

    add_notification(
        session["studentId"], "session",
        "Session cancelled",
        f"'{session['title']}' on {session['date']} was cancelled."
        + (f" Reason: {reason}" if reason else ""),
        link="mentoring-sessions.html",
        meta={"sessionId": session["id"]},
    )

    return ok({"session": session, "message": "Session cancelled."})


@sessions_bp.delete("/<session_id>")
@require_roles("admin")
def delete_session(session_id):
    session = DB["sessions"].get(session_id)
    if not session:
        return err("Session not found.", 404)
    with _lock:
        DB["sessions"].pop(session_id, None)
    log_activity(g.user["id"], "deleted session", session["title"])
    return ok({"message": "Session deleted permanently."})