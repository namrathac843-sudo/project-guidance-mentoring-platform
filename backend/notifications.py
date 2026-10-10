"""
Notification endpoints.

GET    /api/notifications              list for the current user
GET    /api/notifications/unread-count
PUT    /api/notifications/<id>         mark read / unread
PUT    /api/notifications/read-all
DELETE /api/notifications/<id>
DELETE /api/notifications/clear/all

Every notification is created by a real action elsewhere in the app
(project review, mentoring request, session change, message, ...).
Nothing here fabricates events.
"""

from flask import Blueprint, g, request

from .utils import DB, err, ok, require_auth, _lock

notifications_bp = Blueprint("notifications", __name__, url_prefix="/api/notifications")


def _mine(user_id):
    items = [n for n in DB["notifications"].values() if n.get("userId") == user_id]
    items.sort(key=lambda n: n.get("createdAt", ""), reverse=True)
    return items


@notifications_bp.get("")
@require_auth
def list_notifications():
    items = _mine(g.user["id"])

    only_unread = request.args.get("unread") == "true"
    if only_unread:
        items = [n for n in items if not n.get("read")]

    ntype = request.args.get("type")
    if ntype:
        items = [n for n in items if n.get("type") == ntype]

    limit = request.args.get("limit", type=int)
    if limit and limit > 0:
        items = items[:limit]

    unread = len([n for n in _mine(g.user["id"]) if not n.get("read")])
    return ok({"notifications": items, "unreadCount": unread, "count": len(items)})


@notifications_bp.get("/unread-count")
@require_auth
def unread_count():
    unread = len([n for n in _mine(g.user["id"]) if not n.get("read")])
    return ok({"unreadCount": unread})


@notifications_bp.put("/read-all")
@require_auth
def mark_all_read():
    with _lock:
        count = 0
        for n in DB["notifications"].values():
            if n.get("userId") == g.user["id"] and not n.get("read"):
                n["read"] = True
                count += 1
    return ok({"message": f"{count} notification(s) marked as read.", "updated": count})


@notifications_bp.put("/<notification_id>")
@require_auth
def update_notification(notification_id):
    notif = DB["notifications"].get(notification_id)
    if not notif:
        return err("Notification not found.", 404)
    if notif["userId"] != g.user["id"] and g.user["role"] != "admin":
        return err("You can only update your own notifications.", 403)

    data = request.get_json(silent=True) or {}
    if "read" in data:
        with _lock:
            notif["read"] = bool(data["read"])

    return ok({"notification": notif})


@notifications_bp.delete("/clear/all")
@require_auth
def clear_all():
    with _lock:
        doomed = [nid for nid, n in DB["notifications"].items()
                  if n.get("userId") == g.user["id"]]
        for nid in doomed:
            DB["notifications"].pop(nid, None)
    return ok({"message": f"{len(doomed)} notification(s) deleted.", "deleted": len(doomed)})


@notifications_bp.delete("/<notification_id>")
@require_auth
def delete_notification(notification_id):
    notif = DB["notifications"].get(notification_id)
    if not notif:
        return err("Notification not found.", 404)
    if notif["userId"] != g.user["id"] and g.user["role"] != "admin":
        return err("You can only delete your own notifications.", 403)

    with _lock:
        DB["notifications"].pop(notification_id, None)

    return ok({"message": "Notification deleted."})