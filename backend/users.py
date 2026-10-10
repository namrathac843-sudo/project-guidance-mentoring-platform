"""
User endpoints.

GET    /api/users                 (admin, or filtered mentor directory)
GET    /api/users/<user_id>
PUT    /api/users/<user_id>       (self, or admin)
DELETE /api/users/<user_id>       (self, or admin)
GET    /api/users/activity/recent (admin)

Passwords are never returned; public_user() strips them.
"""

from flask import Blueprint, g, request

from .utils import (
    DB, add_notification, current_user, err, log_activity, now_iso, ok,
    public_user, public_users, require_auth, require_roles, _lock,
)

users_bp = Blueprint("users", __name__, url_prefix="/api/users")

# Fields the owner of an account may change about themselves.
SELF_EDITABLE = {
    "fullName", "collegeName", "department", "bio", "phone", "avatar",
    "semester", "skills", "interests", "certifications", "courses",
    "designation", "experienceYears", "expertise",
    "graduationDepartment", "graduationYear", "company", "jobDesignation",
    "mentorAvailability",
}

# Extra fields only an admin may change.
ADMIN_ONLY = {"role", "status", "email", "usn"}


@users_bp.get("")
@require_auth
def list_users():
    """
    Admins see everyone.
    Everyone else sees only mentors (lecturers + alumni), which is what
    the Mentors page needs.
    """
    if g.user["role"] == "admin":
        users = sorted(DB["users"].values(), key=lambda u: u.get("createdAt", ""))
    else:
        users = sorted(
            [u for u in DB["users"].values()
             if u.get("role") in ("lecturer", "alumni")],
            key=lambda u: u.get("fullName", ""),
        )

    # Optional query filters
    role = request.args.get("role")
    if role:
        users = [u for u in users if u.get("role") == role]

    department = request.args.get("department")
    if department:
        users = [u for u in users if u.get("department") == department]

    q = (request.args.get("q") or "").strip().lower()
    if q:
        users = [
            u for u in users
            if q in (u.get("fullName", "").lower())
            or q in (u.get("email", "").lower())
        ]

    return ok({"users": public_users(users), "count": len(users)})


@users_bp.get("/activity/recent")
@require_roles("admin")
def recent_activity():
    feed = DB.get("activity", [])[:25]
    # Attach the acting user's name for readability.
    enriched = []
    for item in feed:
        actor = DB["users"].get(item.get("userId"))
        enriched.append({
            **item,
            "actorName": actor["fullName"] if actor else "Unknown user",
            "actorRole": actor["role"] if actor else "",
        })
    return ok({"activity": enriched})


@users_bp.get("/<user_id>")
@require_auth
def get_user(user_id):
    target = DB["users"].get(user_id)
    if not target:
        return err("User not found.", 404)

    # A student may only view mentors or themselves.
    if g.user["role"] == "student" and target["id"] != g.user["id"]:
        if target.get("role") not in ("lecturer", "alumni"):
            return err("You are not allowed to view this profile.", 403)

    return ok({"user": public_user(target)})


@users_bp.put("/<user_id>")
@require_auth
def update_user(user_id):
    target = DB["users"].get(user_id)
    if not target:
        return err("User not found.", 404)

    is_self = target["id"] == g.user["id"]
    is_admin = g.user["role"] == "admin"

    if not (is_self or is_admin):
        return err("You may only edit your own profile.", 403)

    data = request.get_json(silent=True) or {}
    allowed = set(SELF_EDITABLE)
    if is_admin:
        allowed |= ADMIN_ONLY

    changed = []
    with _lock:
        for key, value in data.items():
            if key not in allowed:
                continue
            if key in ("passwordHash", "id", "createdAt"):
                continue
            if target.get(key) != value:
                target[key] = value
                changed.append(key)
        target["updatedAt"] = now_iso()

    if not changed:
        return ok({
            "user": public_user(target),
            "message": "No changes were needed.",
        })

    log_activity(g.user["id"], "updated profile", f"{target['fullName']}: {', '.join(changed)}")

    if not is_self:
        add_notification(
            target["id"], "account",
            "Your profile was updated",
            f"An administrator updated these fields: {', '.join(changed)}.",
            link="profile.html",
        )

    return ok({
        "user": public_user(target),
        "message": "Profile saved successfully.",
        "changed": changed,
    })


@users_bp.delete("/<user_id>")
@require_auth
def delete_user(user_id):
    target = DB["users"].get(user_id)
    if not target:
        return err("User not found.", 404)

    is_self = target["id"] == g.user["id"]
    is_admin = g.user["role"] == "admin"

    if not (is_self or is_admin):
        return err("You may only delete your own account.", 403)

    # An admin must not delete the last remaining admin.
    if target["role"] == "admin":
        admins = [u for u in DB["users"].values() if u.get("role") == "admin"]
        if len(admins) <= 1:
            return err("You cannot delete the only administrator account.", 400)

    with _lock:
        DB["users"].pop(user_id, None)

        # Remove dependent records so the store stays consistent.
        removed_projects = [
            pid for pid, p in DB["projects"].items()
            if p.get("studentId") == user_id or p.get("guideId") == user_id
        ]
        for pid in removed_projects:
            DB["projects"].pop(pid, None)

        for coll in ("mentoring_requests", "sessions", "messages", "notifications"):
            doomed = [
                rid for rid, r in DB[coll].items()
                if r.get("userId") == user_id
                or r.get("studentId") == user_id
                or r.get("mentorId") == user_id
                or r.get("senderId") == user_id
                or r.get("receiverId") == user_id
            ]
            for rid in doomed:
                DB[coll].pop(rid, None)

    log_activity(g.user["id"], "deleted account", target.get("email", ""))

    return ok({
        "message": "Account deleted.",
        "removedProjects": len(removed_projects),
    })