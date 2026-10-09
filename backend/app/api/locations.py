from flask_restx import Namespace, Resource, reqparse

from ..services import geocoding
from ..models import HazardReferencePoint, Hotspot
from .swagger_models import error_model, geocode_response


ns = Namespace("locations", description="Server-side geocoding (Google Geocoding API)", path="/locations")


@ns.route("/hotspots")
class HotspotsResource(Resource):
    def get(self):
        """Return uploaded reference hotspots for the workspace map."""
        items = Hotspot.query.order_by(Hotspot.name).all()
        return {"items": [{"id": item.id, "name": item.name, "latitude": item.latitude,
                           "longitude": item.longitude, "severity": item.severity} for item in items], "total": len(items)}


@ns.route("/flood-reference")
class FloodReferenceResource(Resource):
    def get(self):
        """Fixed Nairobi susceptibility reference for Accumulation, separate from uploaded insured assets."""
        points = HazardReferencePoint.query.order_by(HazardReferencePoint.id).all()
        hotspots = Hotspot.query.order_by(Hotspot.name).all()
        return {
            "points": [{"id": point.id, "latitude": point.latitude, "longitude": point.longitude,
                        "hazardScores": point.scores} for point in points],
            "hotspots": [{"id": spot.id, "name": spot.name, "latitude": spot.latitude,
                          "longitude": spot.longitude, "severity": spot.severity} for spot in hotspots],
            "referenceUploadIds": sorted({point.source_upload_id for point in points if point.source_upload_id}),
            "pointCount": len(points),
            "hotspotCount": len(hotspots),
            "method": "Five 0–1 susceptibility proxy scores at reference locations; not flood extents or measured probabilities.",
        }

geocode_parser = reqparse.RequestParser()
geocode_parser.add_argument("q", type=str, required=True, location="args", help="Address, neighbourhood, or place in Nairobi")


@ns.route("/geocode")
class GeocodeResource(Resource):
    @ns.expect(geocode_parser)
    @ns.response(404, "No match", error_model)
    @ns.response(502, "Geocoding provider error", error_model)
    @ns.response(503, "Geocoding not configured", error_model)
    def get(self):
        """Geocode a location, biased to Nairobi. `precision` is rooftop, street, neighbourhood, city, or region."""
        query = geocode_parser.parse_args()["q"].strip()
        geocoder = geocoding.get_geocoder()
        if geocoder is None:
            return {"error": "geocoding_unavailable", "message": "GOOGLE_MAPS_API_KEY is not configured on the server."}, 503
        try:
            result = geocoder.geocode(query)
        except geocoding.GeocodingError as exc:
            return {"error": "geocoding_failed", "message": str(exc)}, 502
        if result is None:
            return {"error": "not_found", "message": f"No location found for '{query}'."}, 404
        return ns.marshal(result.as_dict() | {"dummy": False}, geocode_response)
