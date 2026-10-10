"""
Project endpoints.

GET    /api/projects                       list (role-filtered)
POST   /api/projects                       create (JSON metadata)
POST   /api/projects/<id>/upload           upload a file (multipart)
GET    /api/projects/<id>
PUT    /api/projects/<id>                  edit (owner / guide / admin)
POST   /api/projects/<id>/review           accept / reject / request changes
GET    /api/projects/<id>/download         download the stored file
GET    /api/projects/stats/summary         chart data

Files are written to UPLOAD_FOLDER/<project_id>/<safe_name>.
Everything else lives in memory and is lost when Flask restarts.
"""

import os

from flask import Blueprint, current_app, g, request, send_file

from .utils import (
    DB, add_notification, err, log_activity, new_id, now_iso, ok,
    require_auth, require_roles, sanitize_filename, validate_upload, _lock,
)

projects_bp = Blueprint("projects", __name__, url_prefix="/api/projects")

VALID_STATUSES = [
    "Draft", "Submitted", "Under Review",
    "Accepted", "Changes Requested", "Rejected",
]

# Which reviewer action moves a project to which status.
REVIEW_ACTIONS = {
    "start_review": "Under Review",
    "accept": "Accepted",
    "reject": "Rejected",
    "request_changes": "Changes Requested",
}


# ---------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------

def _can_view(user, project):
    if user["role"] == "admin":
        return True
    if project.get("studentId") == user["id"]:
        return True
    if project.get("guideId") == user["id"]:
        return True
    if user["role"] == "lecturer":
        # Lecturers may review any project in their own department.
        return project.get("department") == user.get("department")
    if user["role"] == "alumni":
        # Alumni only see projects they are mentoring.
        return any(
            r.get("mentorId") == user["id"]
            and r.get("studentId") == project.get("studentId")
            and r.get("status") == "Accepted"
            for r in DB["mentoring_requests"].values()
        )
    return False


def _can_edit(user, project):
    return (
        user["role"] == "admin"
        or project.get("studentId") == user["id"]
        or project.get("guideId") == user["id"]
    )


def _push_history(project, actor, status, note):
    project.setdefault("history", []).append({
        "status": status,
        "by": actor["id"] if actor else None,
        "byName": actor["fullName"] if actor else "System",
        "note": note,
        "at": now_iso(),
    })


# ---------------------------------------------------------------------
# List / create
# ---------------------------------------------------------------------

@projects_bp.get("")
@require_auth
def list_projects():
    user = g.user
    all_projects = list(DB["projects"].values())

    if user["role"] == "student":
        visible = [p for p in all_projects if p.get("studentId") == user["id"]]
    elif user["role"] == "lecturer":
        visible = [
            p for p in all_projects
            if p.get("guideId") == user["id"]
            or p.get("department") == user.get("department")
            or p.get("status") in ("Submitted", "Under Review")
        ]
    elif user["role"] == "alumni":
        mentee_ids = {
            r["studentId"] for r in DB["mentoring_requests"].values()
            if r.get("mentorId") == user["id"] and r.get("status") == "Accepted"
        }
        visible = [p for p in all_projects if p.get("studentId") in mentee_ids]
    else:  # admin
        visible = all_projects

    # Query filters
    status = request.args.get("status")
    if status:
        visible = [p for p in visible if p.get("status") == status]

    department = request.args.get("department")
    if department:
        visible = [p for p in visible if p.get("department") == department]

    q = (request.args.get("q") or "").strip().lower()
    if q:
        visible = [
            p for p in visible
            if q in p.get("title", "").lower()
            or q in p.get("description", "").lower()
        ]

    sort = request.args.get("sort", "newest")
    if sort == "oldest":
        visible.sort(key=lambda p: p.get("createdAt", ""))
    elif sort == "title":
        visible.sort(key=lambda p: p.get("title", "").lower())
    elif sort == "progress":
        visible.sort(key=lambda p: p.get("progress", 0), reverse=True)
    else:
        visible.sort(key=lambda p: p.get("createdAt", ""), reverse=True)

    return ok({"projects": visible, "count": len(visible)})


@projects_bp.post("")
@require_roles("student", "admin")
def create_project():
    data = request.get_json(silent=True) or {}

    if not (data.get("title") or "").strip():
        return err("A project title is required.")
    if not (data.get("description") or "").strip():
        return err("A project description is required.")

    student_id = data.get("studentId") or g.user["id"]
    if g.user["role"] == "student" and student_id != g.user["id"]:
        return err("You can only create projects for your own account.", 403)

    project = {
        "id": new_id("project"),
        "title": data["title"].strip(),
        "description": data["description"].strip(),
        "category": data.get("category", ""),
        "department": data.get("department", g.user.get("department", "")),
        "semester": data.get("semester", g.user.get("semester", "")),
        "teamMembers": data.get("teamMembers", []),
        "studentId": student_id,
        "guideId": data.get("guideId") or "",
        "deadline": data.get("deadline", ""),
        "status": "Draft",
        "progress": 0,
        "feedback": "",
        "fileName": "",
        "storedPath": "",
        "fileSize": 0,
        "createdAt": now_iso(),
        "updatedAt": now_iso(),
        "history": [],
    }
    _push_history(project, g.user, "Draft", "Project created")

    with _lock:
        DB["projects"][project["id"]] = project

    log_activity(g.user["id"], "created project", project["title"])

    # Notify the chosen guide.
    if project["guideId"] and project["guideId"] in DB["users"]:
        add_notification(
            project["guideId"], "project",
            "New project assigned to you",
            f"{g.user['fullName']} created the project '{project['title']}'.",
            link="projects.html",
            meta={"projectId": project["id"]},
        )

    return ok({"project": project, "message": "Project created."}), 201


# ---------------------------------------------------------------------
# Single project
# ---------------------------------------------------------------------

@projects_bp.get("/<project_id>")
@require_auth
def get_project(project_id):
    project = DB["projects"].get(project_id)
    if not project:
        return err("Project not found.", 404)
    if not _can_view(g.user, project):
        return err("You are not allowed to view this project.", 403)
    return ok({"project": project})


@projects_bp.put("/<project_id>")
@require_auth
def update_project(project_id):
    project = DB["projects"].get(project_id)
    if not project:
        return err("Project not found.", 404)
    if not _can_edit(g.user, project):
        return err("You are not allowed to edit this project.", 403)

    data = request.get_json(silent=True) or {}

    # A student may not edit while the project is Accepted/Rejected
    # unless the lecturer requested changes.
    if g.user["role"] == "student" and project["status"] in ("Accepted", "Rejected"):
        return err(
            f"This project is {project['status']} and can no longer be edited.",
            409,
        )

    editable = {
        "title", "description", "category", "department", "semester",
        "teamMembers", "guideId", "deadline",
    }
    if g.user["role"] in ("lecturer", "admin"):
        editable |= {"progress", "feedback", "status"}

    changed = []
    with _lock:
        for key, value in data.items():
            if key in editable and project.get(key) != value:
                project[key] = value
                changed.append(key)

        # Progress must stay between 0 and 100.
        try:
            project["progress"] = max(0, min(100, int(project.get("progress", 0))))
        except (TypeError, ValueError):
            project["progress"] = 0

        project["updatedAt"] = now_iso()

    if changed:
        log_activity(g.user["id"], "updated project", f"{project['title']}: {', '.join(changed)}")

    return ok({
        "project": project,
        "message": "Project updated." if changed else "No changes were needed.",
    })


# ---------------------------------------------------------------------
# Upload
# ---------------------------------------------------------------------

@projects_bp.post("/<project_id>/upload")
@require_auth
def upload_file(project_id):
    project = DB["projects"].get(project_id)
    if not project:
        return err("Project not found.", 404)
    if not _can_edit(g.user, project):
        return err("You are not allowed to upload files to this project.", 403)

    if "file" not in request.files:
        return err("No file part named 'file' was found in the request.")

    cfg = current_app.config
    valid, info = validate_upload(request.files["file"], cfg)
    if not valid:
        return err(info, 400)

    # One folder per project keeps files isolated.
    project_dir = os.path.join(cfg["UPLOAD_FOLDER"], project_id)
    os.makedirs(project_dir, exist_ok=True)

    # Prefix with a short unique token so re-uploads never overwrite
    # each other and the original name is still recognisable.
    safe_name = info["safeName"]
    stored_name = f"{new_id('f')[:10]}_{safe_name}"
    absolute_path = os.path.join(project_dir, stored_name)

    # Final safety check: the resolved path must stay inside project_dir.
    if not os.path.abspath(absolute_path).startswith(os.path.abspath(project_dir)):
        return err("Unsafe file path detected. Upload rejected.", 400)

    try:
        request.files["file"].save(absolute_path)
    except OSError as exc:
        current_app.logger.exception("Upload failed")
        return err(f"Could not save the file on the server: {exc}", 500)

    with _lock:
        project["fileName"] = info["originalName"]
        project["storedName"] = stored_name
        project["storedPath"] = absolute_path
        project["fileSize"] = info["size"]
        project["updatedAt"] = now_iso()

        # Uploading a file moves a Draft into Submitted.
        if project["status"] in ("Draft", "Changes Requested"):
            project["status"] = "Submitted"
            _push_history(project, g.user, "Submitted", "File uploaded for review")

    log_activity(g.user["id"], "uploaded file", f"{info['originalName']} ({info['size']} bytes)")

    # Notify the guide.
    if project.get("guideId") and project["guideId"] in DB["users"]:
        add_notification(
            project["guideId"], "project",
            "New project submission",
            f"'{project['title']}' was submitted by {g.user['fullName']}.",
            link="projects.html",
            meta={"projectId": project["id"]},
        )

    return ok({
        "project": project,
        "file": {
            "name": info["originalName"],
            "size": info["size"],
            "mime": info["mime"],
        },
        "message": "File uploaded successfully.",
    })


# ---------------------------------------------------------------------
# Download
# ---------------------------------------------------------------------

@projects_bp.get("/<project_id>/download")
@require_auth
def download_file(project_id):
    project = DB["projects"].get(project_id)
    if not project:
        return err("Project not found.", 404)

    # Explicit authorisation check BEFORE touching the filesystem.
    if not _can_view(g.user, project):
        return err("You are not authorised to download this file.", 403)

    stored_path = project.get("storedPath")
    if not stored_path:
        return err("This project has no uploaded file.", 404)

    if not os.path.isfile(stored_path):
        return err(
            "The file record exists but the file is missing from the server "
            "(it may have been deleted or Flask was restarted on a different machine).",
            404,
        )

    log_activity(g.user["id"], "downloaded file", project.get("fileName", ""))

    return send_file(
        stored_path,
        as_attachment=True,
        download_name=project.get("fileName") or "project-file",
    )


# ---------------------------------------------------------------------
# Review workflow
# ---------------------------------------------------------------------

@projects_bp.post("/<project_id>/review")
@require_roles("lecturer", "admin")
def review_project(project_id):
    project = DB["projects"].get(project_id)
    if not project:
        return err("Project not found.", 404)

    if g.user["role"] == "lecturer" and not _can_view(g.user, project):
        return err("You are not authorised to review this project.", 403)

    data = request.get_json(silent=True) or {}
    action = (data.get("action") or "").strip()
    feedback = (data.get("feedback") or "").strip()

    if action not in REVIEW_ACTIONS:
        return err(
            "Unknown review action. Use one of: "
            + ", ".join(REVIEW_ACTIONS.keys())
        )

    new_status = REVIEW_ACTIONS[action]

    # Rejections and change requests must carry a reason.
    if action in ("reject", "request_changes") and not feedback:
        return err("Feedback is required when rejecting or requesting changes.")

    old_status = project["status"]

    with _lock:
        project["status"] = new_status
        if feedback:
            project["feedback"] = feedback
        if action == "accept":
            project["progress"] = max(project.get("progress", 0), 100)
        project["reviewedBy"] = g.user["id"]
        project["reviewedAt"] = now_iso()
        project["updatedAt"] = now_iso()
        _push_history(project, g.user, new_status, feedback or action)

    log_activity(
        g.user["id"], "reviewed project",
        f"{project['title']}: {old_status} -> {new_status}",
    )

    # Notify the student with the reviewer's feedback.
    titles = {
        "Accepted": "Project accepted",
        "Rejected": "Project rejected",
        "Changes Requested": "Changes requested on your project",
        "Under Review": "Your project is under review",
    }
    add_notification(
        project["studentId"], "project",
        titles.get(new_status, "Project status updated"),
        f"'{project['title']}' is now '{new_status}'."
        + (f" Feedback: {feedback}" if feedback else ""),
        link="projects.html",
        meta={"projectId": project["id"], "status": new_status},
    )

    return ok({
        "project": project,
        "message": f"Project moved from '{old_status}' to '{new_status}'.",
    })


# ---------------------------------------------------------------------
# Chart statistics
# ---------------------------------------------------------------------

@projects_bp.get("/stats/summary")
@require_auth
def stats_summary():
    """
    Aggregated numbers for the dashboards and Chart.js.

    Everything is computed from real stored records. When there are no
    records the client shows an empty state instead of fake numbers.
    """
    user = g.user
    projects = list(DB["projects"].values())

    if user["role"] == "student":
        projects = [p for p in projects if p.get("studentId") == user["id"]]
    elif user["role"] == "lecturer":
        projects = [
            p for p in projects
            if p.get("guideId") == user["id"]
            or p.get("department") == user.get("department")
        ]

    by_status = {s: 0 for s in VALID_STATUSES}
    for p in projects:
        by_status[p.get("status", "Draft")] = by_status.get(p.get("status", "Draft"), 0) + 1

    # Submissions grouped by month (ISO yyyy-mm).
    over_time = {}
    for p in projects:
        month = (p.get("createdAt") or "")[:7]
        if month:
            over_time[month] = over_time.get(month, 0) + 1

    progress_points = [
        {"title": p.get("title", "Untitled"), "progress": int(p.get("progress", 0))}
        for p in sorted(projects, key=lambda x: x.get("createdAt", ""), reverse=True)[:10]
    ]

    users_by_role = {"student": 0, "lecturer": 0, "alumni": 0, "admin": 0}
    for u in DB["users"].values():
        users_by_role[u.get("role", "student")] = users_by_role.get(u.get("role", "student"), 0) + 1

    return ok({
        "totalProjects": len(projects),
        "byStatus": by_status,
        "overTime": [{"month": m, "count": c} for m, c in sorted(over_time.items())],
        "progress": progress_points,
        "usersByRole": users_by_role,
        "totalUsers": len(DB["users"]),
    })