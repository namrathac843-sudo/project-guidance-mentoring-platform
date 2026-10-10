"""
Authentication endpoints.

POST /api/auth/register
POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/me
POST /api/auth/forgot-password
POST /api/auth/reset-password

SECURITY NOTE
-------------
This is a classroom demonstration. Tokens are random strings held in a
Python dict, so they disappear when Flask restarts, and there is no
refresh/expiry logic. Do not treat this as production authentication.
"""

import re

from flask import Blueprint, current_app, g, request

from .utils import (
    DB, add_notification, err, find_user_by_email, find_user_by_usn,
    hash_password, is_valid_email_format, is_valid_usn, issue_token,
    log_activity, missing_fields, new_id, norm_email, now_iso, ok,
    password_problem, public_user, require_auth, revoke_token,
    token_from_request, verify_password, _lock,
)

auth_bp = Blueprint("auth", __name__, url_prefix="/api/auth")


# ---------------------------------------------------------------------
# Validation helpers
# ---------------------------------------------------------------------

def _validate_email_for_role(cfg, role, email, usn):
    """
    Apply the college email rules.

    Rules
    -----
    Student:
        If REQUIRE_STUDENT_USN_EMAIL is true, the email MUST be
        <USN>@<COLLEGE_EMAIL_DOMAIN>, and the USN part must equal the
        USN the student typed.
    Lecturer / Alumni:
        If STRICT_EMAIL_FOR_ALL_ROLES is true, they must also use the
        college domain. Otherwise any valid email is accepted.
    Admin:
        Never allowed through public registration.

    Returns (True, "") or (False, "message").
    """
    domain = cfg["COLLEGE_EMAIL_DOMAIN"].lower()
    email_l = norm_email(email)

    if not is_valid_email_format(email_l):
        return False, "Please enter a valid email address."

    if role == "student":
        if cfg["REQUIRE_STUDENT_USN_EMAIL"]:
            expected_local = (usn or "").strip().lower()
            if not expected_local:
                return False, "USN is required before the email can be validated."
            expected = f"{expected_local}@{domain}"
            if email_l != expected:
                return False, (
                    f"Your college email must be exactly '{expected}' "
                    "(your USN followed by the college domain)."
                )
    else:
        if cfg["STRICT_EMAIL_FOR_ALL_ROLES"]:
            if not email_l.endswith("@" + domain):
                return False, (
                    f"Your email must end with '@{domain}' for this role."
                )

    return True, ""


def _validate_usn_for_role(cfg, role, usn):
    if role in ("student", "lecturer", "alumni"):
        # USN is required for students; optional but validated for others.
        if role == "student":
            if not usn:
                return False, "USN is required for students."
            if not is_valid_usn(usn, cfg["USN_PATTERN"]):
                return False, (
                    "USN format looks invalid. Expected something like "
                    "'1GA21CS001'. Ask your administrator to adjust the "
                    "USN_PATTERN setting if your college uses another format."
                )
        elif usn and not is_valid_usn(usn, cfg["USN_PATTERN"]):
            return False, "Institutional ID format looks invalid."
    return True, ""


# ---------------------------------------------------------------------
# Register
# ---------------------------------------------------------------------

@auth_bp.post("/register")
def register():
    cfg = current_app.config
    data = request.get_json(silent=True) or {}

    required = [
        "fullName", "email", "collegeName", "department",
        "role", "password", "confirmPassword",
    ]
    missing = missing_fields(data, required)
    if missing:
        return err("Please fill in all required fields: " + ", ".join(missing))

    role = (data.get("role") or "").strip().lower()
    if role not in ("student", "lecturer", "alumni"):
        return err(
            "Public registration is available for students, lecturers and "
            "alumni only. Administrator accounts are created by an existing "
            "administrator."
        )

    email = norm_email(data["email"])
    usn = (data.get("usn") or data.get("institutionalId") or "").strip().upper()

    # --- Email rules ------------------------------------------------
    ok_email, email_msg = _validate_email_for_role(cfg, role, email, usn)
    if not ok_email:
        return err(email_msg)

    # --- USN rules ---------------------------------------------------
    ok_usn, usn_msg = _validate_usn_for_role(cfg, role, usn)
    if not ok_usn:
        return err(usn_msg)

    # --- Duplicates ---------------------------------------------------
    if find_user_by_email(email):
        return err("An account with this email already exists.", 409)
    if usn and find_user_by_usn(usn):
        return err("An account with this USN already exists.", 409)

    # --- Password -----------------------------------------------------
    problem = password_problem(data["password"])
    if problem:
        return err(problem)
    if data["password"] != data["confirmPassword"]:
        return err("Password and Confirm Password do not match.")

    # --- Build the record ---------------------------------------------
    user = {
        "id": new_id("user"),
        "fullName": data["fullName"].strip(),
        "email": email,
        "collegeName": data.get("collegeName", "").strip(),
        "department": data.get("department", "").strip(),
        "usn": usn,
        "role": role,
        "passwordHash": hash_password(data["password"]),
        "status": "Active",
        "avatar": "",
        "bio": "",
        "phone": "",
        "createdAt": now_iso(),
        "updatedAt": now_iso(),
    }

    if role == "student":
        user.update({
            "semester": data.get("semester", ""),
            "skills": data.get("skills", []),
            "interests": data.get("interests", ""),
            "certifications": [],
            "courses": [],
            "mentorAvailability": False,
        })
    elif role == "lecturer":
        user.update({
            "designation": data.get("designation", ""),
            "experienceYears": data.get("experienceYears", ""),
            "expertise": data.get("expertise", []),
            "skills": data.get("skills", []),
            "mentorAvailability": True,
        })
    elif role == "alumni":
        user.update({
            "graduationDepartment": data.get("graduationDepartment", ""),
            "graduationYear": data.get("graduationYear", ""),
            "company": data.get("company", ""),
            "jobDesignation": data.get("jobDesignation", ""),
            "expertise": data.get("expertise", []),
            "skills": data.get("skills", []),
            "mentorAvailability": True,
        })

    with _lock:
        DB["users"][user["id"]] = user

    log_activity(user["id"], "registered", f"{user['fullName']} joined as {role}")
    add_notification(
        user["id"], "account",
        "Welcome to the platform",
        "Your account was created successfully. Complete your profile to get started.",
        link="profile.html",
    )

    return ok({
        "user": public_user(user),
        "message": "Registration successful. You can now log in.",
    }), 201


# ---------------------------------------------------------------------
# Login / logout
# ---------------------------------------------------------------------

@auth_bp.post("/login")
def login():
    data = request.get_json(silent=True) or {}
    email = norm_email(data.get("email"))
    password = data.get("password") or ""

    if not email or not password:
        return err("Email and password are required.")

    user = find_user_by_email(email)

    # Same generic message for "no such user" and "wrong password" so we
    # do not leak which emails are registered.
    if not user or not verify_password(user.get("passwordHash", ""), password):
        return err("Invalid email or password.", 401)

    if user.get("status") == "Deactivated":
        return err(
            "This account has been deactivated. Please contact an administrator.",
            403,
        )

    token = issue_token(user["id"])
    log_activity(user["id"], "logged in", user["email"])

    return ok({
        "token": token,
        "user": public_user(user),
    })


@auth_bp.post("/logout")
@require_auth
def logout():
    token = token_from_request()
    revoke_token(token)
    log_activity(g.user["id"], "logged out", "")
    return ok({"message": "You have been logged out."})


@auth_bp.get("/me")
@require_auth
def me():
    return ok({"user": public_user(g.user)})


# ---------------------------------------------------------------------
# Forgot / reset password (LOCAL DEMO FLOW — documented)
# ---------------------------------------------------------------------
#
# There is no email server in this project, so we cannot truly send a
# reset link. Instead:
#   1. The user submits their email.
#   2. If the account exists we generate a one-time token and return it
#      in the JSON response (clearly marked as a demo token).
#   3. The frontend shows the token on screen and lets the user set a
#      new password immediately.
#
# In a real deployment step 2 would send an email and the token would
# NEVER be returned in the HTTP response.
# ---------------------------------------------------------------------

@auth_bp.post("/forgot-password")
def forgot_password():
    data = request.get_json(silent=True) or {}
    email = norm_email(data.get("email"))
    if not email:
        return err("Please enter your email address.")

    user = find_user_by_email(email)

    # Always answer the same way so attackers cannot enumerate accounts.
    generic = {
        "message": (
            "If an account exists for that email, a reset token has been "
            "generated."
        )
    }

    if not user:
        return ok(generic)

    token = new_id("reset")
    with _lock:
        DB["password_resets"][token] = {
            "userId": user["id"],
            "createdAt": now_iso(),
        }

    # DEMO ONLY: the token is returned so you can complete the flow
    # without an email server.
    return ok({
        **generic,
        "demoResetToken": token,
        "demoNotice": (
            "DEMO MODE: no email was sent. This token is shown only because "
            "this classroom build has no mail server."
        ),
    })


@auth_bp.post("/reset-password")
def reset_password():
    data = request.get_json(silent=True) or {}
    token = (data.get("token") or "").strip()
    new_password = data.get("password") or ""
    confirm = data.get("confirmPassword") or ""

    if not token:
        return err("A reset token is required.")

    with _lock:
        record = DB["password_resets"].get(token)

    if not record:
        return err("This reset token is invalid or has already been used.", 400)

    problem = password_problem(new_password)
    if problem:
        return err(problem)
    if new_password != confirm:
        return err("Password and Confirm Password do not match.")

    with _lock:
        user = DB["users"].get(record["userId"])
        if not user:
            return err("The account linked to this token no longer exists.", 404)
        user["passwordHash"] = hash_password(new_password)
        user["updatedAt"] = now_iso()
        DB["password_resets"].pop(token, None)

    add_notification(
        user["id"], "account",
        "Password changed",
        "Your password was reset successfully.",
        link="settings.html",
    )

    return ok({"message": "Password updated. You can now log in."})