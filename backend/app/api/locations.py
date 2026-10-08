from flask_restx import Namespace, Resource, reqparse

from .swagger_models import geocode_response


ns = Namespace("locations", description="Google-compatible location search contract", path="/locations")

geocode_parser = reqparse.RequestParser()
geocode_parser.add_argument("q", type=str, required=True, location="args", help="Address, neighbourhood, or coordinates")


@ns.route("/geocode")
class GeocodeResource(Resource):
    @ns.expect(geocode_parser)
    @ns.marshal_with(geocode_response)
    def get(self):
        """Geocode a location. Dummy response will later be replaced by Google server-side geocoding."""
        query = geocode_parser.parse_args()["q"]
        return {"formattedAddress": f"{query}, Nairobi, Kenya", "latitude": -1.2921, "longitude": 36.8219, "provider": "dummy", "precision": "city", "dummy": True}

