from flask import request
from flask_restx import Namespace, Resource, reqparse

from ..services import dummy
from .swagger_models import (
    cluster_list_response,
    portfolio_summary_model,
    property_create_request,
    property_list_item_model,
    property_list_response,
)


ns = Namespace("portfolios", description="Portfolio search, summaries, clusters, and exports", path="/portfolios")

property_parser = reqparse.RequestParser()
property_parser.add_argument("q", type=str, location="args", help="Property ID, neighbourhood, or coordinates")
property_parser.add_argument("housingClass", type=str, location="args")
property_parser.add_argument("hazardBand", type=str, location="args", help="Comma-separated risk bands")
property_parser.add_argument("minTiv", type=float, location="args")
property_parser.add_argument("maxTiv", type=float, location="args")
property_parser.add_argument("minProbability", type=float, location="args")
property_parser.add_argument("nearHotspotKm", type=float, location="args")
property_parser.add_argument("aiFlagged", type=str, choices=("true", "false"), location="args")
property_parser.add_argument("bbox", type=str, location="args", help="minLng,minLat,maxLng,maxLat")
property_parser.add_argument("sort", type=str, location="args", default="aal:desc")
property_parser.add_argument("limit", type=int, location="args", default=50)
property_parser.add_argument("cursor", type=str, location="args")


@ns.route("/<string:portfolio_id>/summary")
class PortfolioSummaryResource(Resource):
    @ns.marshal_with(portfolio_summary_model)
    def get(self, portfolio_id):
        """Return portfolio-level underwriting metrics."""
        return dummy.portfolio_summary(portfolio_id)


@ns.route("/<string:portfolio_id>/properties")
class PortfolioPropertiesResource(Resource):
    @ns.expect(property_parser)
    @ns.marshal_with(property_list_response)
    def get(self, portfolio_id):
        """Search, filter, sort, and paginate portfolio properties and map markers."""
        return dummy.list_properties(portfolio_id, property_parser.parse_args())

    @ns.expect(property_create_request, validate=True)
    @ns.marshal_with(property_list_item_model, code=201)
    def post(self, portfolio_id):
        """Add a synthetic exposure; hazard and loss remain pending until a model run."""
        return dummy.create_property(portfolio_id, request.get_json()), 201


@ns.route("/<string:portfolio_id>/clusters")
class PortfolioClustersResource(Resource):
    @ns.doc(params={"type": "neighbourhood | grid | hazard_band | housing_class"})
    @ns.marshal_with(cluster_list_response)
    def get(self, portfolio_id):
        """Return cluster metrics for treemap, bubble chart, and accumulation cards."""
        return dummy.list_clusters(portfolio_id, request.args.get("type", "neighbourhood"))


@ns.route("/<string:portfolio_id>/export")
class PortfolioExportResource(Resource):
    @ns.doc(params={"format": "csv | xlsx | geojson"})
    def get(self, portfolio_id):
        """Request a portfolio export. Returns a dummy download contract."""
        export_format = request.args.get("format", "csv")
        return {"portfolioId": portfolio_id, "format": export_format, "status": "ready", "downloadUrl": f"/downloads/{portfolio_id}.{export_format}", "dummy": True}

