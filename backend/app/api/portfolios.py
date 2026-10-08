from flask import request
from flask_restx import Namespace, Resource, reqparse

from ..services import repository
from ..services.repository import RepositoryError
from .uploads import create_portfolio_upload, list_portfolio_uploads, portfolio_review_queue, upload_parser
from .swagger_models import (
    cluster_list_response,
    error_model,
    portfolio_summary_model,
    property_create_request,
    property_created_model,
    property_list_response,
)


ns = Namespace("portfolios", description="Portfolio search, summaries, clusters, and exports", path="/portfolios")

property_parser = reqparse.RequestParser()
property_parser.add_argument("q", type=str, location="args", help="Property ID, neighbourhood, or coordinates")
property_parser.add_argument("uploadId", type=str, location="args", help="Only properties from this upload")
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
        """Return portfolio-level exposure totals. Loss metrics are null until a model run completes."""
        result = repository.portfolio_summary(portfolio_id)
        if result is None:
            ns.abort(404, f"Portfolio {portfolio_id} was not found.")
        return result


@ns.route("/<string:portfolio_id>/properties")
class PortfolioPropertiesResource(Resource):
    @ns.expect(property_parser)
    @ns.marshal_with(property_list_response)
    def get(self, portfolio_id):
        """Search, filter, sort, and paginate portfolio properties and map markers."""
        try:
            result = repository.list_properties(portfolio_id, property_parser.parse_args())
        except RepositoryError as exc:
            ns.abort(exc.status, exc.message)
        if result is None:
            ns.abort(404, f"Portfolio {portfolio_id} was not found.")
        return result

    @ns.expect(property_create_request, validate=True)
    @ns.marshal_with(property_created_model, code=201)
    def post(self, portfolio_id):
        """Add a synthetic exposure; hazard and loss remain pending until a model run."""
        try:
            return repository.create_property(portfolio_id, request.get_json()), 201
        except RepositoryError as exc:
            ns.abort(exc.status, exc.message)


@ns.route("/<string:portfolio_id>/clusters")
class PortfolioClustersResource(Resource):
    @ns.doc(params={"type": "neighbourhood | grid | hazard_band | housing_class", "uploadId": "Optional uploaded data source ID"})
    @ns.marshal_with(cluster_list_response)
    def get(self, portfolio_id):
        """Return cluster exposure for treemap and accumulation cards. Loss metrics are null until a model run completes."""
        try:
            result = repository.list_clusters(portfolio_id, request.args.get("type", "neighbourhood"), request.args.get("uploadId"))
        except RepositoryError as exc:
            ns.abort(exc.status, exc.message)
        if result is None:
            ns.abort(404, f"Portfolio {portfolio_id} was not found.")
        return result


@ns.route("/<string:portfolio_id>/export")
class PortfolioExportResource(Resource):
    @ns.doc(params={"format": "csv | xlsx | geojson"})
    def get(self, portfolio_id):
        """Request a portfolio export. Returns a dummy download contract."""
        export_format = request.args.get("format", "csv")
        return {"portfolioId": portfolio_id, "format": export_format, "status": "ready", "downloadUrl": f"/downloads/{portfolio_id}.{export_format}", "dummy": True}



@ns.route("/<string:portfolio_id>/uploads")
class PortfolioUploadsResource(Resource):
    def get(self, portfolio_id):
        """List uploads for the portfolio, newest first."""
        return list_portfolio_uploads(portfolio_id)

    @ns.expect(upload_parser)
    @ns.response(201, "Upload stored and processed")
    @ns.response(200, "Identical file already uploaded; the existing upload is returned")
    @ns.response(400, "Rejected file", error_model)
    @ns.response(413, "File too large", error_model)
    def post(self, portfolio_id):
        """Upload a CSV, XLSX, PDF, or text file. The original is kept unchanged and table rows are validated and promoted."""
        return create_portfolio_upload(portfolio_id)


queue_parser = reqparse.RequestParser()
queue_parser.add_argument("limit", type=int, location="args", default=100)
queue_parser.add_argument("offset", type=int, location="args", default=0)


@ns.route("/<string:portfolio_id>/review-queue")
class PortfolioReviewQueueResource(Resource):
    @ns.expect(queue_parser)
    def get(self, portfolio_id):
        """Rows awaiting a reviewer: needs_review rows and properties left unconfirmed by low-confidence AI mapping."""
        args = queue_parser.parse_args()
        return portfolio_review_queue(portfolio_id, args["limit"], args["offset"])


search_parser = reqparse.RequestParser()
search_parser.add_argument("q", type=str, required=True, location="args", help="Words to find in uploaded documents")
search_parser.add_argument("limit", type=int, location="args", default=10)


@ns.route("/<string:portfolio_id>/documents/search")
class PortfolioDocumentSearchResource(Resource):
    @ns.expect(search_parser)
    @ns.response(400, "Invalid query", error_model)
    def get(self, portfolio_id):
        """Search the text of uploaded documents; each hit carries its file, page and a snippet."""
        args = search_parser.parse_args()
        try:
            return repository.search_documents(portfolio_id, args["q"], args["limit"])
        except RepositoryError as exc:
            ns.abort(exc.status, exc.message)
