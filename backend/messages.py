"""
Messaging endpoints.

GET    /api/messages/conversations        list conversation partners
GET    /api/messages/<other_user_id>      message thread
POST   /api/messages                      send a message
PUT    /api/messages/<message_id>/read    mark one message read
DELETE /api/messages/<message_id>         delete own message

This is a simple request/response store, NOT a real-time chat.
There is no WebSocket, no push, and no cross-device sync. Messages
live in Flask's memory and vanish on restart.
"""

from flask import Blueprint, g, request

from .utils import (
    DB, add_notification, err, log_activity, new_id, now_iso, ok,
    public_user, require_auth, _lock,
)

messages_bp = Blueprint("messages", __name__, url_prefix="/api/messages")


# ---------------------------------------------------------------------
# Who may talk to whom
# ---------------------------------------------------------------------

def _may_converse(user, other):
    """
    Authorisation rule for conversations.

    student  <-> lecturer / alumni / admin
    lecturer <-> student / lecturer / alumni / admin
    alumni   <-> student / lecturer / admin
    admin    <-> everyone
    student  <-> student   NOT allowed (keeps it academic)
    """
    a, b = user["role"], other["role"]

    if a == "admin" or b == "admin":
        return True
    if a == "student" and b in ("lecturer", "alumni"):
        return True
    if b == "student" and a in ("lecturer", "alumni"):
        return True
    if a == "lecturer" and b == "lecturer":
        return True
    if a == "alumni" and b == "lecturer":
        return True
    if a == "lecturer" and b == "alumni":
        return True
    if a == "alumni" and b == "alumni":
        return True
    return False


def _thread_key(a, b):
    """Stable key for a pair of users, independent of order."""
    return "|".join(sorted([a, b]))


# ---------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------

@messages_bp.get("/conversations")
@require_auth
def conversations():
    """
    Build the conversation list for the current user from real messages.
    No conversation exists until at least one message is sent.
    """
    me = g.user["id"]
    buckets = {}

    for msg in DB["messages"].values():
        if me not in (msg["senderId"], msg["receiverId"]):
            continue
        other = msg["receiverId"] if msg["senderId"] == me else msg["senderId"]
        bucket = buckets.setdefault(other, {
            "otherUserId": other,
            "lastMessage": "",
            "lastAt": "",
            "unread": 0,
        })
        if msg["createdAt"] >= bucket["lastAt"]:
            bucket["lastAt"] = msg["createdAt"]
            bucket["lastMessage"] = msg["body"][:120]
        if msg["receiverId"] == me and not msg.get("read"):
            bucket["unread"] += 1

    result = []
    for other_id, bucket in buckets.items():
        other = DB["users"].get(other_id)
        if not other:
            continue
        result.append({
            **bucket,
            "otherUserName": other["fullName"],
            "otherUserRole": other["role"],
            "otherUserDepartment": other.get("department", ""),
        })

    result.sort(key=lambda c: c["lastAt"], reverse=True)
    return ok({"conversations": result, "count": len(result)})


@messages_bp.get("/contacts")
@require_auth
def contacts():
    """Users the current user is allowed to start a conversation with."""
    allowed = []
    for u in DB["users"].values():
        if u["id"] == g.user["id"]:
            continue
        if u.get("status") == "Deactivated":
            continue
        if _may_converse(g.user, u):
            allowed.append(public_user(u))
    allowed.sort(key=lambda u: u.get("fullName", ""))
    return ok({"contacts": allowed, "count": len(allowed)})


@messages_bp.get("/<other_user_id>")
@require_auth
def thread(other_user_id):
    other = DB["users"].get(other_user_id)
    if not other:
        return err("User not found.", 404)
    if not _may_converse(g.user, other):
        return err("You are not allowed to message this user.", 403)

    me = g.user["id"]
    msgs = [
        m for m in DB["messages"].values()
        if {m["senderId"], m["receiverId"]} == {me, other_user_id}
    ]
    msgs.sort(key=lambda m: m["createdAt"])

    # Auto-mark received messages as read.
    with _lock:
        for m in msgs:
            if m["receiverId"] == me and not m.get("read"):
                m["read"] = True
                m["readAt"] = now_iso()

    return ok({
        "messages": msgs,
        "otherUser": public_user(other),
        "count": len(msgs),
    })


@messages_bp.post("")
@require_auth
def send_message():
    data = request.get_json(silent=True) or {}
    receiver_id = (data.get("receiverId") or "").strip()
    body = (data.get("body") or "").strip()

    if not receiver_id:
        return err("A recipient is required.")
    if not body:
        return err("Cannot send an empty message.")
    if len(body) > 2000:
        return err("Messages are limited to 2000 characters.")

    receiver = DB["users"].get(receiver_id)
    if not receiver:
        return err("Recipient not found.", 404)
    if not _may_converse(g.user, receiver):
        return err("You are not allowed to message this user.", 403)

    msg = {
        "id": new_id("msg"),
        "conversationKey": _thread_key(g.user["id"], receiver_id),
        "senderId": g.user["id"],
        "senderName": g.user["fullName"],
        "receiverId": receiver_id,
        "receiverName": receiver["fullName"],
        "body": body,
        "read": False,
        "readAt": None,
        "createdAt": now_iso(),
    }

    with _lock:
        DB["messages"][msg["id"]] = msg

    add_notification(
        receiver_id, "message",
        "New message",
        f"{g.user['fullName']}: {body[:80]}{'...' if len(body) > 80 else ''}",
        link="messages.html",
        meta={"senderId": g.user["id"], "messageId": msg["id"]},
    )

    return ok({"message": msg, "notice": "Message stored on the server."}), 201


@messages_bp.put("/<message_id>/read")
@require_auth
def mark_read(message_id):
    msg = DB["messages"].get(message_id)
    if not msg:
        return err("Message not found.", 404)
    if msg["receiverId"] != g.user["id"]:
        return err("You can only mark your own received messages as read.", 403)

    with _lock:
        msg["read"] = True
        msg["readAt"] = now_iso()

    return ok({"message": msg})


@messages_bp.delete("/<message_id>")
@require_auth
def delete_message(message_id):
    msg = DB["messages"].get(message_id)
    if not msg:
        return err("Message not found.", 404)
    if msg["senderId"] != g.user["id"] and g.user["role"] != "admin":
        return err("You can only delete messages you sent.", 403)

    with _lock:
        DB["messages"].pop(message_id, None)

    return ok({"message": "Message deleted."})