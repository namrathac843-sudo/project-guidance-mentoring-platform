"""
Shared backend helpers:

  * the in-memory "database" (a plain dict, guarded by a lock)
  * ID generation and timestamps
  * token handling for the demo API
  * current-user resolution and role decorators
  * input validators (email, USN, password)
  * file-upload validation (extension + MIME + magic bytes + size)
  * notification creation

REMINDER: everything inside DB is lost when Flask restarts. Uploaded
files live on disk in UPLOAD_FOLDER and DO survive a restart.
"""

import os
import re
import threading
import uuid
from datetime import datetime, timezone
from functools import wraps

from flask import g, request
from werkzeug.security import check_password_hash, generate_password_hash
from werkzeug.utils import secure_filename

# =====================================================================
# 1. In-memory store
# =====================================================================

_lock = threading.RLock()

DB = {
    "users": {},                 # user_id  -> user dict
    "projects": {},              # project_id -> project dict
    "mentoring_requests": {},    # request_id -> request dict
    "sessions": {},              # session_id -> session dict
    "messages": {},              # message_id -> message dict
    "notifications": {},         # notification_id -> notification dict
    "password_resets": {},       # token -> {userId, expiresAt}
}

# token -> user_id   (demo bearer tokens, memory only)
TOKENS = {}


# =====================================================================
# 2. Small utilities
# =====================================================================

def new_id(prefix: str) -> str:
    """Return a short, unique, prefixed identifier."""
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def now_iso() -> str:
    """Current UTC time as an ISO-8601 string (second precision)."""
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def norm_email(value: str) -> str:
    """Lower-case and strip an email address for comparisons."""
    return (value or "").strip().lower()


def ok(data=None, **extra):
    """Successful JSON response body."""
    payload = {"success": True}
    if data is not None:
        payload["data"] = data
    payload.update(extra)
    return payload


def err(message: str, status: int = 400, **extra):
    """Error JSON response: returns a (body, status) tuple for Flask."""
    payload = {"success": False, "error": message}
    payload.update(extra)
    return payload, status


# =====================================================================
# 3. Serialisation
# =====================================================================

# Fields that must never leave the server.
_SECRET_FIELDS = {"passwordHash", "password_hash"}


def public_user(user: dict):
    """Strip secrets before returning a user object to the client."""
    if not user:
        return None
    return {k: v for k, v in user.items() if k not in _SECRET_FIELDS}


def public_users(user_list):
    return [public_user(u) for u in user_list]


# =====================================================================
# 4. Authentication helpers
# =====================================================================

def hash_password(raw: str) -> str:
    """PBKDF2-SHA256 hash with a random salt (Werkzeug default)."""
    return generate_password_hash(raw, method="pbkdf2:sha256")


def verify_password(stored_hash: str, raw: str) -> bool:
    try:
        return check_password_hash(stored_hash, raw)
    except Exception:
        return False


def issue_token(user_id: str) -> str:
    token = uuid.uuid4().hex + uuid.uuid4().hex[:8]
    with _lock:
        TOKENS[token] = user_id
    return token


def revoke_token(token: str) -> None:
    with _lock:
        TOKENS.pop(token, None)


def token_from_request():
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:].strip()
    return None


def current_user():
    """Resolve the caller from the Bearer token, or None."""
    token = token_from_request()
    if not token:
        return None
    with _lock:
        user_id = TOKENS.get(token)
        if not user_id:
            return None
        return DB["users"].get(user_id)


def require_auth(fn):
    """Decorator: 401 unless a valid Bearer token is present."""
    @wraps(fn)
    def wrapper(*args, **kwargs):
        user = current_user()
        if not user:
            return err("Authentication required. Please log in.", 401)
        if user.get("status") == "Deactivated":
            return err("This account has been deactivated.", 403)
        g.user = user
        return fn(*args, **kwargs)
    return wrapper


def require_roles(*roles):
    """Decorator: 403 unless the caller's role is in `roles`."""
    def decorator(fn):
        @wraps(fn)
        @require_auth
        def wrapper(*args, **kwargs):
            if g.user.get("role") not in roles:
                return err(
                    "You do not have permission to perform this action.", 403
                )
            return fn(*args, **kwargs)
        return wrapper
    return decorator


# =====================================================================
# 5. Validators
# =====================================================================

EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$")


def is_valid_email_format(email: str) -> bool:
    return bool(EMAIL_RE.match((email or "").strip()))


def is_valid_usn(usn: str, pattern: str) -> bool:
    return bool(re.match(pattern, (usn or "").strip().upper()))


def password_problem(password: str):
    """
    Return a human-readable problem string, or None if the password is OK.
    Rules: >= 8 chars, at least one letter, at least one digit.
    """
    if not password or len(password) < 8:
        return "Password must be at least 8 characters long."
    if not re.search(r"[A-Za-z]", password):
        return "Password must contain at least one letter."
    if not re.search(r"[0-9]", password):
        return "Password must contain at least one number."
    return None


def missing_fields(data: dict, fields):
    """Return the list of required keys that are missing or blank."""
    missing = []
    for f in fields:
        value = data.get(f)
        if value is None or (isinstance(value, str) and not value.strip()):
            missing.append(f)
    return missing


# =====================================================================
# 6. File-upload validation
# =====================================================================

# Magic-byte signatures for the formats we accept.
_SIGNATURES = {
    b"%PDF": "pdf",
    b"PK\x03\x04": "zip",       # docx / pptx / xlsx are ZIP containers
    b"\xd0\xcf\x11\xe0": "ole",  # legacy doc / ppt / xls
}


def sniff_signature(head: bytes) -> str:
    """Return a rough family name for the first bytes of a file."""
    for sig, name in _SIGNATURES.items():
        if head.startswith(sig):
            return name
    return "unknown"


def sanitize_filename(name: str) -> str:
    """
    Produce a filesystem-safe filename.

    secure_filename() strips directory separators, '..', and non-ASCII
    characters, which prevents path traversal.
    """
    base = os.path.basename(name or "")
    safe = secure_filename(base)
    if not safe:
        safe = "upload"
    # Keep a sensible length so we do not blow up the filesystem limit.
    return safe[:120]


def validate_upload(file_storage, config):
    """
    Validate an uploaded FileStorage.

    Returns (True, info_dict) on success or (False, message) on failure.

    Checks performed:
      1. A filename exists and has an extension.
      2. The extension is on the allow-list.
      3. The declared MIME type is plausible (when provided).
      4. The file's magic bytes match the claimed extension family.
      5. The size is within the configured limit.
    """
    if file_storage is None or not file_storage.filename:
        return False, "No file was provided."

    original = file_storage.filename
    if "." not in original:
        return False, "The file must have an extension (for example .pdf)."

    ext = original.rsplit(".", 1)[1].lower()
    if ext not in config["ALLOWED_EXTENSIONS"]:
        allowed = ", ".join(sorted(config["ALLOWED_EXTENSIONS"]))
        return False, f"Unsupported file type '.{ext}'. Allowed types: {allowed}."

    # --- MIME check (best-effort: browsers are inconsistent) -------
    mime = (file_storage.mimetype or "").lower()
    if mime and mime not in config["ALLOWED_MIMETYPES"]:
        return False, f"The browser reported an unsupported content type: {mime}."

    # --- Size + signature check ------------------------------------
    stream = file_storage.stream
    try:
        start = stream.tell()
    except Exception:
        start = 0

    stream.seek(0, os.SEEK_END)
    size = stream.tell()
    stream.seek(0)
    head = stream.read(8)
    stream.seek(0)

    if size == 0:
        return False, "The uploaded file is empty."

    if size > config["MAX_CONTENT_LENGTH"]:
        limit_mb = config["MAX_CONTENT_LENGTH"] // (1024 * 1024)
        return False, f"The file is too large. Maximum allowed size is {limit_mb} MB."

    family = sniff_signature(head)

    # Files that legitimately start with plain text: csv (and some xls exports)
    text_like = ext == "csv"

    compatible = {
        "pdf": {"pdf"},
        "ppt": {"ole"},
        "doc": {"ole"},
        "xls": {"ole"},
        "pptx": {"zip"},
        "docx": {"zip"},
        "xlsx": {"zip"},
    }
    expected = compatible.get(ext, set())

    if expected and family not in expected:
        if not (text_like and family == "unknown"):
            return False, (
                f"The file content does not look like a real .{ext} file. "
                "Please upload a genuine document."
            )

    safe_name = sanitize_filename(original)

    return True, {
        "originalName": original,
        "safeName": safe_name,
        "extension": ext,
        "size": size,
        "mime": mime,
        "signatureFamily": family,
        "stream": stream,
        "start": start,
    }


# =====================================================================
# 7. Notifications
# =====================================================================

def add_notification(user_id, ntype, title, message, link=None, meta=None):
    """
    Create a notification for a user.

    This is called by real actions (project reviewed, session scheduled,
    message sent, ...). Nothing here invents fake events.
    """
    if not user_id or user_id not in DB["users"]:
        return None
    notif = {
        "id": new_id("notif"),
        "userId": user_id,
        "type": ntype,
        "title": title,
        "message": message,
        "link": link,
        "meta": meta or {},
        "read": False,
        "createdAt": now_iso(),
    }
    with _lock:
        DB["notifications"][notif["id"]] = notif
    return notif


# =====================================================================
# 8. Lookups used by several blueprints
# =====================================================================

def find_user_by_email(email):
    target = norm_email(email)
    for user in DB["users"].values():
        if norm_email(user.get("email")) == target:
            return user
    return None


def find_user_by_usn(usn):
    target = (usn or "").strip().upper()
    if not target:
        return None
    for user in DB["users"].values():
        if (user.get("usn") or "").strip().upper() == target:
            return user
    return None


def mentor_directory():
    """Every user who can act as a mentor (lecturer or alumni)."""
    return [
        u for u in DB["users"].values()
        if u.get("role") in ("lecturer", "alumni")
        and u.get("status", "Active") == "Active"
    ]


def log_activity(user_id, action, detail=None):
    """
    Append an entry to a small in-memory activity feed used by the
    admin dashboard's "Recent platform activity" panel.
    """
    DB.setdefault("activity", [])
    DB["activity"].insert(0, {
        "id": new_id("act"),
        "userId": user_id,
        "action": action,
        "detail": detail or "",
        "createdAt": now_iso(),
    })
    # Keep the feed bounded.
    del DB["activity"][200:]