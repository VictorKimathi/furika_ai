from flask_restx import fields

from ..extensions import api


error_model = api.model("Error", {
    "error": fields.String(required=True, example="not_found"),
    "message": fields.String(required=True, example="The requested resource was not found."),
})

user_model = api.model("User", {
    "id": fields.String(example="USR-001"),
    "name": fields.String(example="Dr. A. Omondi"),
    "email": fields.String(example="analyst@furika.ai"),
    "role": fields.String(example="underwriter"),
})

login_request = api.model("LoginRequest", {
    "email": fields.String(required=True, example="analyst@furika.ai"),
    "password": fields.String(required=True, example="demo-password"),
})

login_response = api.model("LoginResponse", {
    "accessToken": fields.String(example="dummy-access-token"),
    "tokenType": fields.String(example="Bearer"),
    "expiresIn": fields.Integer(example=3600),
    "user": fields.Nested(user_model),
    "dummy": fields.Boolean(example=True),
})

portfolio_summary_model = api.model("PortfolioSummary", {
    "portfolioId": fields.String(example="SYN-PORT-142"),
    "name": fields.String,
    "status": fields.String(enum=["draft", "running", "review", "approved"]),
    "totalInsuredValueKes": fields.Float,
    "propertyCount": fields.Integer,
    "confirmedCount": fields.Integer,
    "unconfirmedCount": fields.Integer,
    "hazardMissingCount": fields.Integer,
    "portfolioAalKes": fields.Float,
    "aalPercentTiv": fields.Float,
    "loss100Kes": fields.Float,
    "highRiskValueKes": fields.Float,
    "highRiskValueShare": fields.Float,
    "aiFlaggedCount": fields.Integer,
    "sourceTag": fields.String,
    "asOf": fields.DateTime,
})

property_list_item_model = api.model("PropertyListItem", {
    "id": fields.String(example="NBO-0002"),
    "portfolioId": fields.String,
    "name": fields.String,
    "region": fields.String,
    "latitude": fields.Float,
    "longitude": fields.Float,
    "housingClass": fields.String,
    "floorAreaM2": fields.Float,
    "costPerM2Kes": fields.Float,
    "insuredValueKes": fields.Float,
    "hazardScore": fields.Float,
    "hazardBand": fields.String,
    "annualFloodProbability": fields.Float,
    "aalKes": fields.Float,
    "loss100Kes": fields.Float,
    "loss250Kes": fields.Float,
    "cluster": fields.String,
    "aiFlagged": fields.Boolean,
    "sourceTag": fields.String,
    "reviewStatus": fields.String(enum=["confirmed", "unconfirmed"]),
    "hazardSource": fields.String(enum=["supplied", "interpolated", "missing"]),
    "geocodePrecision": fields.String,
    "hazardScores": fields.Raw(description="Five proxy hazard scores keyed by tier, or null."),
    "issueCount": fields.Integer(description="Warnings and review items from the upload that last wrote this property."),
    "nearestHotspotKm": fields.Float(description="Distance to the nearest named flood hotspot, or null when none are loaded."),
})

property_created_model = api.clone("PropertyCreated", property_list_item_model, {
    "issues": fields.Raw(description="Warnings and review items raised while evaluating the new property."),
})

property_list_response = api.model("PropertyListResponse", {
    "items": fields.List(fields.Nested(property_list_item_model)),
    "total": fields.Integer,
    "nextCursor": fields.String,
    "dummy": fields.Boolean,
})

property_create_request = api.model("PropertyCreateRequest", {
    "id": fields.String(required=False, example="NBO-0601"),
    "name": fields.String(required=True, example="New synthetic warehouse"),
    "region": fields.String(example="Embakasi"),
    "latitude": fields.Float(example=-1.3071),
    "longitude": fields.Float(example=36.8912),
    "housingClass": fields.String(example="permanent_masonry"),
    "address": fields.String(example="Mombasa Road, Embakasi", description="Geocoded when latitude/longitude are omitted."),
    "floorAreaM2": fields.Float(example=750),
    "costPerM2Kes": fields.Float(example=140000),
    "insuredValueKes": fields.Float(example=105000000),
})

property_detail_model = api.model("PropertyDetail", {
    "identity": fields.Raw(description="Identity, coordinates, region, class, and source tag."),
    "exposure": fields.Raw(description="Floor area, cost per square metre, TIV, and provenance."),
    "hazard": fields.Raw(description="Five tiers, probability, drivers, hotspot, and provenance."),
    "loss": fields.Raw(description="AAL, return-period losses, damage ratios, and EP curve."),
    "explainability": fields.Raw(description="Plain-language summary, warnings, and provenance."),
    "portfolioContext": fields.Raw(description="Rank, cluster, nearby property count, and local TIV."),
    "modelStatus": fields.Raw(description="{state: approved|draft|stale|not_in_run|no_run|not_modellable, runId, canRun, reason}"),
    "dummy": fields.Boolean,
})

cluster_model = api.model("Cluster", {
    "id": fields.String,
    "portfolioId": fields.String,
    "name": fields.String,
    "type": fields.String(enum=["neighbourhood", "grid", "hazard_band", "housing_class"]),
    "propertyCount": fields.Integer,
    "insuredValueKes": fields.Float,
    "loss100Kes": fields.Float,
    "aalPercentTiv": fields.Float,
    "annualFloodProbability": fields.Float,
    "portfolioLossShare": fields.Float,
    "riskBand": fields.String,
    "tivShare": fields.Float,
    "classMix": fields.Raw,
    "hotspotFlag": fields.Boolean,
    "accumulationFlag": fields.String,
})

cluster_list_response = api.model("ClusterListResponse", {
    "items": fields.List(fields.Nested(cluster_model)),
    "total": fields.Integer,
    "dummy": fields.Boolean,
})

run_create_request = api.model("ModelRunCreateRequest", {
    "portfolioId": fields.String(required=True, example="SYN-PORT-142"),
    "configuration": fields.Raw(required=False, example={"scenarioSet": "five-tier-demo"}),
})

run_stage_model = api.model("RunStage", {
    "key": fields.String,
    "title": fields.String,
    "position": fields.Integer,
    "status": fields.String(enum=["waiting", "running", "completed", "review", "failed"]),
    "output": fields.Raw,
})

run_model = api.model("ModelRun", {
    "id": fields.String(example="RUN-143"),
    "portfolioId": fields.String,
    "status": fields.String,
    "currentStage": fields.String,
    "configuration": fields.Raw,
    "createdAt": fields.DateTime,
    "stages": fields.List(fields.Nested(run_stage_model)),
    "dummy": fields.Boolean,
})

decision_request = api.model("RunDecisionRequest", {
    "action": fields.String(required=True, enum=["approve", "return"]),
    "comment": fields.String(required=False, example="Sources and assumptions reviewed."),
})

decision_response = api.model("RunDecisionResponse", {
    "runId": fields.String,
    "action": fields.String,
    "comment": fields.String,
    "status": fields.String,
    "decidedAt": fields.DateTime,
    "dummy": fields.Boolean,
})

chat_context_model = api.model("ChatContext", {
    "portfolioId": fields.String(required=False),
    "propertyId": fields.String(required=False),
    "runId": fields.String(required=False),
    "uploadIds": fields.List(fields.String, required=False),
})

chat_request = api.model("ChatRequest", {
    "message": fields.String(required=True, example="Explain the risk at NBO-0002."),
    "mode": fields.String(enum=["analysis", "exposure"], default="analysis"),
    "context": fields.Nested(chat_context_model, required=False),
})

chat_response_model = api.model("ChatResponse", {
    "answer": fields.String,
    "asset": fields.Raw,
    "source": fields.String,
    "citations": fields.List(fields.Raw),
    "actions": fields.List(fields.Raw),
    "workflow": fields.Raw(description="Model run backing the answer: {runId, status, created}. status=review means it awaits approval."),
    "provider": fields.String(example="claude"),
    "model": fields.String(example="claude-opus-5-5"),
    "dummy": fields.Boolean,
})

chat_create_request = api.model("ChatCreateRequest", {
    "title": fields.String(example="Mathare risk review"),
    "context": fields.Nested(chat_context_model, required=False),
})

chat_model = api.model("Chat", {
    "id": fields.String,
    "title": fields.String,
    "context": fields.Raw,
    "messages": fields.List(fields.Raw),
    "updatedAt": fields.DateTime,
    "dummy": fields.Boolean,
})

message_request = api.model("MessageCreateRequest", {
    "role": fields.String(required=True, enum=["user", "assistant", "system"]),
    "content": fields.String(required=True),
})

message_model = api.model("Message", {
    "id": fields.String,
    "role": fields.String,
    "content": fields.String,
    "createdAt": fields.DateTime,
})

geocode_request = api.model("GeocodeRequest", {
    "query": fields.String(required=True, example="Westlands, Nairobi"),
})

geocode_response = api.model("GeocodeResponse", {
    "formattedAddress": fields.String,
    "latitude": fields.Float,
    "longitude": fields.Float,
    "provider": fields.String,
    "precision": fields.String,
    "dummy": fields.Boolean,
})

exposure_rows_request = api.model("ExposureRowsRequest", {
    "exposure": fields.List(fields.Raw, required=True, description="Exposure rows using the canonical Furika columns."),
})

model_run_calculation_request = api.inherit("ModelCalculationRequest", exposure_rows_request, {
    "hotspots": fields.List(fields.Raw, required=False, description="Optional hotspot rows with name, lat, lon, and severity or weight."),
    "configuration": fields.Raw(required=False, description="tierRp, dMaxM, wetThresholdM, applyUplift, and upliftRadiusKm."),
})

validation_response = api.model("ExposureValidationResponse", {
    "valid": fields.Boolean,
    "rowCount": fields.Integer,
    "issues": fields.List(fields.String),
    "requiredColumns": fields.List(fields.String),
})

calculation_response = api.model("ModelCalculationResponse", {
    "validationIssues": fields.List(fields.String),
    "monotonicViolations": fields.List(fields.Raw),
    "totalTivKes": fields.Float,
    "tierLosses": fields.List(fields.Raw),
    "lossByClass": fields.List(fields.Raw),
    "epCurve": fields.List(fields.Raw),
    "aal": fields.Raw,
    "aalPercentTiv": fields.Float,
    "floodProbability": fields.List(fields.Raw),
    "localAccumulation": fields.List(fields.Raw),
    "hotspotValidation": fields.Raw,
    "assumptions": fields.Raw,
})

damage_ratio_request = api.model("DamageRatioRequest", {
    "depthM": fields.List(fields.Float, required=True, example=[0, 0.5, 1, 2, 4]),
    "housingClass": fields.List(fields.String, required=True, example=["semi_permanent"] * 5),
    "parameters": fields.Raw(required=False),
})

ep_curve_request = api.model("EpCurveRequest", {
    "points": fields.List(fields.Raw, required=True, example=[{"rp": 10, "lossKes": 707000}, {"rp": 100, "lossKes": 2569000}, {"rp": 250, "lossKes": 2673000}]),
})

hotspot_uplift_request = api.model("HotspotUpliftRequest", {
    "exposure": fields.List(fields.Raw, required=True),
    "hotspots": fields.List(fields.Raw, required=True),
    "radiusKm": fields.Float(default=1.0),
    "minimum": fields.Float(default=0.01),
})
