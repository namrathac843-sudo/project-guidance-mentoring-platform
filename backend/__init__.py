"""
Application factory.

Creates the Flask app, registers every REST blueprint, and serves the
frontend single-page files from ./frontend.

Why a factory?
  It keeps imports clean and lets tests create a fresh app instance
  without side effects.
"""

import os

from flask import Flask, jsonify, request, send_from_directory
from werkzeug.exceptions import HTTPException

from .config import Config

# Absolute path to the frontend folder, computed once.
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")


def create_app():
    # static_folder=None because WE serve the frontend manually below.
    app = Flask(__name__, static_folder=None)
    app.config.from_object(Config)

    # Make sure the uploads folder exists.
    os.makedirs(app.config["UPLOAD_FOLDER"], exist_ok=True)

    # ---------------------------------------------------------------
    # Register API blueprints
    # ---------------------------------------------------------------
    from .auth import auth_bp
    from .users import users_bp
    from .projects import projects_bp
    from .mentors import mentors_bp
    from .sessions import sessions_bp
    from .messages import messages_bp
    from .notifications import notifications_bp

    app.register_blueprint(auth_bp)
    app.register_blueprint(users_bp)
    app.register_blueprint(projects_bp)
    app.register_blueprint(mentors_bp)
    app.register_blueprint(sessions_bp)
    app.register_blueprint(messages_bp)
    app.register_blueprint(notifications_bp)

    # ---------------------------------------------------------------
    # Health check (useful for the frontend "backend online?" badge)
    # ---------------------------------------------------------------
    @app.get("/api/health")
    def health():
        return jsonify({"success": True, "data": {"status": "ok"}})

    # ---------------------------------------------------------------
    # Frontend delivery
    # ---------------------------------------------------------------
    @app.get("/")
    def serve_index():
        return send_from_directory(FRONTEND_DIR, "index.html")

    @app.get("/<path:filename>")
    def serve_frontend(filename):
        """
        Serves any file inside ./frontend (html, css, js, images).

        send_from_directory already blocks path traversal ('../'),
        so this is safe.
        """
        return send_from_directory(FRONTEND_DIR, filename)

    # ---------------------------------------------------------------
    # JSON error handlers so the API never returns an HTML error page
    # ---------------------------------------------------------------
    @app.errorhandler(HTTPException)
    def handle_http_exception(exc):
        if request.path.startswith("/api/"):
            return jsonify({
                "success": False,
                "error": exc.description or exc.name,
                "code": exc.code,
            }), exc.code
        # For non-API paths fall back to the default HTML behaviour.
        return exc

    @app.errorhandler(413)
    def handle_too_large(exc):
        limit_mb = app.config["MAX_CONTENT_LENGTH"] // (1024 * 1024)
        return jsonify({
            "success": False,
            "error": f"File is too large. The limit is {limit_mb} MB.",
        }), 413

    @app.errorhandler(Exception)
    def handle_unexpected(exc):
        if request.path.startswith("/api/"):
            app.logger.exception("Unhandled API error")
            return jsonify({
                "success": False,
                "error": "Internal server error. Check the Flask console for details.",
            }), 500
        raise exc

    return app