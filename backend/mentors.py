"""
Mentor directory and mentoring-request endpoints.

GET    /api/mentors                          list mentors (with filters)
GET    /api/mentors/<mentor_id>              one mentor's public profile
POST   /api/mentoring-requests               student requests a mentor
GET    /api/mentoring-requests               list (role-filtered)
PUT    /api/mentoring-requests/<id>          accept / decline / cancel
"""

from flask import Blueprint, g, request

from .utils import (
    DB, add_notification, err, log_activity, mentor_directory, new_id,
    now_iso, ok, public_user, require_auth, require_roles, _lock,
)

mentors_bp = Blueprint("mentors", __name__, url_prefix="/api")


# ---------------------------------------------------------------------
# Mentor directory
# ---------------------------------------------------------------------

@mentors_bp.get("/mentors")
@require_auth
def list_mentors():
    mentors = mentor_directory()

    role = request.args.get("role")
    if role in ("lecturer", "alumni"):
        mentors = [m for m in mentors if m.get("role") == role]

    department = request.args.get("department")
    if department:
        mentors = [m for m in mentors if m.get("department") == department]

    expertise = request.args.get("expertise")
    if expertise:
        needle = expertise.lower()
        mentors = [
            m for m in mentors
            if any(needle in str(e).lower() for e in (m.get("expertise") or []))
            or any(needle in str(s).lower() for s in (m.get("skills") or []))
        ]

    q = (request.args.get("q") or "").strip().lower()
    if q:
        mentors = [
            m for m in mentors
            if q in m.get("fullName", "").lower()
            or q in (m.get("company") or "").lower()
            or q in (m.get("designation") or "").lower()
            or q in (m.get("jobDesignation") or "").lower()
        ]

    # Attach the caller's existing request status so the UI can show
    # "Request pending" instead of an active button.
    my_requests = {
        r["mentorId"]: r
        for r in DB["mentoring_requests"].values()
        if r.get("studentId") == g.user["id"]
    }

    result = []
    for m in mentors:
        item = public_user(m)
        req = my_requests.get(m["id"])
        item["myRequestStatus"] = req["status"] if req else None
        item["myRequestId"] = req["id"] if req else None
        result.append(item)

    result.sort(key=lambda x: x.get("fullName", ""))
    return ok({"mentors": result, "count": len(result)})


@mentors_bp.get("/mentors/<mentor_id>")
@require_auth
def get_mentor(mentor_id):
    mentor = DB["users"].get(mentor_id)
    if not mentor or mentor.get("role") not in ("lecturer", "alumni"):
        return err("Mentor not found.", 404)

    profile = public_user(mentor)

    # Include a short summary of that mentor's sessions.
    upcoming = [
        s for s in DB["sessions"].values()
        if s.get("mentorId") == mentor_id and s.get("status") == "Scheduled"
    ]
    profile["upcomingSessionCount"] = len(upcoming)
    return ok({"mentor": profile})


# ---------------------------------------------------------------------
# Mentoring requests
# ---------------------------------------------------------------------

@mentors_bp.post("/mentoring-requests")
@require_roles("student")
def create_request():
    data = request.get_json(silent=True) or {}
    mentor_id = (data.get("mentorId") or "").strip()
    message = (data.get("message") or "").strip()
    topic = (data.get("topic") or "").strip()

    mentor = DB["users"].get(mentor_id)
    if not mentor:
        return err("The selected mentor does not exist.", 404)
    if mentor.get("role") not in ("lecturer", "alumni"):
        return err("The selected user is not a mentor.")

    # One open request per student-mentor pair.
    for r in DB["mentoring_requests"].values():
        if (r.get("studentId") == g.user["id"]
                and r.get("mentorId") == mentor_id
                and r.get("status") in ("Pending", "Accepted")):
            return err(
                f"You already have a {r['status'].lower()} request with this mentor.",
                409,
            )

    if not topic:
        return err("Please provide a topic for the mentoring request.")

    req = {
        "id": new_id("mreq"),
        "studentId": g.user["id"],
        "studentName": g.user["fullName"],
        "mentorId": mentor_id,
        "mentorName": mentor["fullName"],
        "topic": topic,
        "message": message,
        "projectId": data.get("projectId") or "",
        "status": "Pending",
        "responseNote": "",
        "createdAt": now_iso(),
        "updatedAt": now_iso(),
    }

    with _lock:
        DB["mentoring_requests"][req["id"]] = req

    log_activity(g.user["id"], "sent mentoring request", f"to {mentor['fullName']}")

    add_notification(
        mentor_id, "mentoring",
        "New mentoring request",
        f"{g.user['fullName']} requested mentoring about '{topic}'.",
        link="mentors.html",
        meta={"requestId": req["id"]},
    )

    return ok({"request": req, "message": "Mentoring request sent."}), 201


@mentors_bp.get("/mentoring-requests")
@require_auth
def list_requests():
    user = g.user
    all_reqs = list(DB["mentoring_requests"].values())

    if user["role"] == "student":
        visible = [r for r in all_reqs if r.get("studentId") == user["id"]]
    elif user["role"] in ("lecturer", "alumni"):
        visible = [r for r in all_reqs if r.get("mentorId") == user["id"]]
    else:
        visible = all_reqs

    status = request.args.get("status")
    if status:
        visible = [r for r in visible if r.get("status") == status]

    visible.sort(key=lambda r: r.get("createdAt", ""), reverse=True)
    return ok({"requests": visible, "count": len(visible)})


@mentors_bp.put("/mentoring-requests/<request_id>")
@require_auth
def update_request(request_id):
    req = DB["mentoring_requests"].get(request_id)
    if not req:
        return err("Mentoring request not found.", 404)

    data = request.get_json(silent=True) or {}
    action = (data.get("action") or "").strip().lower()
    note = (data.get("note") or "").strip()

    is_mentor = req["mentorId"] == g.user["id"]
    is_student = req["studentId"] == g.user["id"]
    is_admin = g.user["role"] == "admin"

    if action in ("accept", "decline"):
        if not (is_mentor or is_admin):
            return err("Only the mentor can accept or decline this request.", 403)
        new_status = "Accepted" if action == "accept" else "Declined"
    elif action == "cancel":
        if not (is_student or is_admin):
            return err("Only the student can cancel this request.", 403)
        if req["status"] != "Pending":
            return err("Only a pending request can be cancelled.", 409)
        new_status = "Cancelled"
    else:
        return err("Unknown action. Use accept, decline or cancel.")

    if req["status"] != "Pending" and action in ("accept", "decline"):
        return err(f"This request has already been {req['status'].lower()}.", 409)

    with _lock:
        req["status"] = new_status
        req["responseNote"] = note
        req["updatedAt"] = now_iso()

    log_activity(g.user["id"], f"{new_status.lower()} mentoring request", req["topic"])

    add_notification(
        req["studentId"], "mentoring",
        f"Mentoring request {new_status.lower()}",
        f"Your request about '{req['topic']}' was {new_status.lower()} by "
        f"{g.user['fullName']}." + (f" Note: {note}" if note else ""),
        link="mentors.html",
        meta={"requestId": req["id"]},
    )

    return ok({"request": req, "message": f"Request {new_status.lower()}."})