from flask_restx import Namespace, Resource

from ..services import dummy
from .swagger_models import error_model, property_detail_model


ns = Namespace("properties", description="Complete property hazard, loss, and explainability detail", path="/properties")


@ns.route("/<string:property_id>")
class PropertyDetailResource(Resource):
    @ns.marshal_with(property_detail_model)
    @ns.response(404, "Property not found", error_model)
    def get(self, property_id):
        """Return exposure, five-tier hazard, EP loss, provenance, and portfolio context."""
        result = dummy.property_detail(property_id)
        if result is None:
            ns.abort(404, f"Property {property_id} was not found.")
        return result


@ns.route("/<string:property_id>/hazard")
class PropertyHazardResource(Resource):
    @ns.response(404, "Property not found", error_model)
    def get(self, property_id):
        """Return only the property hazard section."""
        result = dummy.property_detail(property_id)
        if result is None:
            ns.abort(404, f"Property {property_id} was not found.")
        return result["hazard"] | {"dummy": True}


@ns.route("/<string:property_id>/loss")
class PropertyLossResource(Resource):
    @ns.response(404, "Property not found", error_model)
    def get(self, property_id):
        """Return only the property financial-loss and EP-curve section."""
        result = dummy.property_detail(property_id)
        if result is None:
            ns.abort(404, f"Property {property_id} was not found.")
        return result["loss"] | {"dummy": True}

