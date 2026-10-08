from flask import request
from flask_restx import Namespace, Resource

from .swagger_models import error_model, login_request, login_response, user_model


ns = Namespace("auth", description="Underwriter authentication and session endpoints", path="/auth")

DUMMY_USER = {"id": "USR-001", "name": "Dr. A. Omondi", "email": "analyst@furika.ai", "role": "underwriter"}


@ns.route("/login")
class LoginResource(Resource):
    @ns.doc(security=[])
    @ns.expect(login_request, validate=True)
    @ns.marshal_with(login_response, code=200)
    @ns.response(400, "Invalid login body", error_model)
    def post(self):
        """Authenticate a user. Returns a dummy token until identity integration is added."""
        payload = request.get_json()
        user = {**DUMMY_USER, "email": payload["email"]}
        return {"accessToken": "dummy-access-token", "tokenType": "Bearer", "expiresIn": 3600, "user": user, "dummy": True}


@ns.route("/me")
class CurrentUserResource(Resource):
    @ns.marshal_with(user_model)
    def get(self):
        """Return the current authenticated user."""
        return DUMMY_USER


@ns.route("/logout")
class LogoutResource(Resource):
    @ns.response(204, "Session ended")
    def post(self):
        """End the current session."""
        return "", 204

