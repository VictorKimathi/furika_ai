from flask import request
from flask_restx import Namespace, Resource

from ..extensions import db
from ..models import FieldProvenance, Property, UploadRow
from ..services import repository
from .uploads import iso, provenance_dict
from .swagger_models import error_model, property_detail_model


ns = Namespace("properties", description="Complete property hazard, loss, and explainability detail", path="/properties")


@ns.route("/<string:property_id>")
class PropertyDetailResource(Resource):
    @ns.marshal_with(property_detail_model)
    @ns.response(404, "Property not found", error_model)
    @ns.doc(params={"includeDraft": "true to show results from a run awaiting approval when no approved results exist"})
    def get(self, property_id):
        """Return exposure, five-tier hazard, EP loss, provenance, portfolio context and model status."""
        result = repository.property_detail(property_id, include_draft=request.args.get("includeDraft") == "true")
        if result is None:
            ns.abort(404, f"Property {property_id} was not found.")
        return result


@ns.route("/<string:property_id>/hazard")
class PropertyHazardResource(Resource):
    @ns.response(404, "Property not found", error_model)
    def get(self, property_id):
        """Return only the property hazard section."""
        result = repository.property_detail(property_id)
        if result is None:
            ns.abort(404, f"Property {property_id} was not found.")
        return result["hazard"] | {"dummy": False}


@ns.route("/<string:property_id>/loss")
class PropertyLossResource(Resource):
    @ns.response(404, "Property not found", error_model)
    def get(self, property_id):
        """Return only the property financial-loss and EP-curve section."""
        result = repository.property_detail(property_id)
        if result is None:
            ns.abort(404, f"Property {property_id} was not found.")
        return result["loss"] | {"dummy": False}



@ns.route("/<string:property_id>/provenance")
class PropertyProvenanceResource(Resource):
    @ns.response(404, "Property not found", error_model)
    def get(self, property_id):
        """Return field-by-field provenance from the latest upload row, plus earlier rows that touched this property."""
        prop = db.session.get(Property, property_id)
        if prop is None:
            ns.abort(404, f"Property {property_id} was not found.")
        rows = UploadRow.query.filter_by(property_id=property_id).order_by(UploadRow.created_at.desc()).all()
        current = []
        if rows:
            current = [
                provenance_dict(item)
                for item in FieldProvenance.query.filter_by(subject_type="upload_row", subject_id=rows[0].id, superseded_by=None).order_by(FieldProvenance.field)
            ]
        return {
            "propertyId": prop.id,
            "reviewStatus": prop.review_status,
            "geocodePrecision": prop.geocode_precision,
            "hazardSource": prop.hazard_source,
            "current": current,
            "history": [{"uploadId": row.upload_id, "rowId": row.id, "rowRef": row.row_ref, "createdAt": iso(row.created_at)} for row in rows],
        }
