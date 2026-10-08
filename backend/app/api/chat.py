from flask import request
from flask_restx import Namespace, Resource

from ..services import dummy
from .swagger_models import (
    chat_create_request,
    chat_model,
    chat_request,
    chat_response_model,
    error_model,
    message_model,
    message_request,
)


chat_ns = Namespace("chat", description="Furika AI analysis and exposure extraction", path="/chat")
chats_ns = Namespace("chats", description="Persistent recent-chat history", path="/chats")


@chat_ns.route("")
class ChatResource(Resource):
    @chat_ns.expect(chat_request, validate=True)
    @chat_ns.marshal_with(chat_response_model)
    def post(self):
        """Generate an analyst response or parse a proposed synthetic exposure."""
        return dummy.chat_response(request.get_json())


@chats_ns.route("")
class ChatCollectionResource(Resource):
    def get(self):
        """List recent conversations for the current user."""
        return dummy.list_chats()

    @chats_ns.expect(chat_create_request, validate=True)
    @chats_ns.marshal_with(chat_model, code=201)
    def post(self):
        """Create a conversation with optional portfolio, property, or run context."""
        return dummy.create_chat(request.get_json()), 201


@chats_ns.route("/<string:chat_id>")
class ChatDetailResource(Resource):
    @chats_ns.response(204, "Conversation deleted")
    @chats_ns.response(404, "Conversation not found", error_model)
    def delete(self, chat_id):
        """Delete a recent conversation."""
        if chat_id not in dummy.CHATS:
            chats_ns.abort(404, f"Chat {chat_id} was not found.")
        del dummy.CHATS[chat_id]
        return "", 204


@chats_ns.route("/<string:chat_id>/messages")
class ChatMessagesResource(Resource):
    @chats_ns.response(404, "Conversation not found", error_model)
    def get(self, chat_id):
        """Return all messages in a conversation."""
        messages = dummy.chat_messages(chat_id)
        if messages is None:
            chats_ns.abort(404, f"Chat {chat_id} was not found.")
        return {"items": messages, "total": len(messages), "dummy": True}

    @chats_ns.expect(message_request, validate=True)
    @chats_ns.marshal_with(message_model, code=201)
    @chats_ns.response(404, "Conversation not found", error_model)
    def post(self, chat_id):
        """Append a user, assistant, or system message."""
        message = dummy.add_chat_message(chat_id, request.get_json())
        if message is None:
            chats_ns.abort(404, f"Chat {chat_id} was not found.")
        return message, 201

