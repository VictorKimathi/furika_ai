"""Deterministic prototype services.

These functions intentionally avoid database and model execution. Their return
shapes are the stable API contract that real repositories and model workers can
implement later.
"""

from copy import deepcopy
from datetime import UTC, datetime
from itertools import count

from .gemini import gemini_service


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


PROPERTIES = [
    {
        "id": "NBO-0002",
        "portfolioId": "SYN-PORT-142",
        "name": "Mathare 4A",
        "region": "Mathare",
        "latitude": -1.2584,
        "longitude": 36.8554,
        "housingClass": "informal_iron_sheet",
        "floorAreaM2": 126.0,
        "costPerM2Kes": 146031.75,
        "insuredValueKes": 18_400_000,
        "hazardScore": 0.91,
        "hazardBand": "severe",
        "annualFloodProbability": 0.50,
        "aalKes": 2_310_000,
        "loss100Kes": 11_800_000,
        "loss250Kes": 15_600_000,
        "cluster": "Mathare Basin",
        "aiFlagged": True,
        "sourceTag": "synthetic",
    },
    {
        "id": "NBO-0091",
        "portfolioId": "SYN-PORT-142",
        "name": "Mathare North",
        "region": "Mathare",
        "latitude": -1.2568,
        "longitude": 36.8581,
        "housingClass": "permanent_masonry",
        "floorAreaM2": 510.0,
        "costPerM2Kes": 141176.47,
        "insuredValueKes": 72_000_000,
        "hazardScore": 0.88,
        "hazardBand": "severe",
        "annualFloodProbability": 0.20,
        "aalKes": 5_840_000,
        "loss100Kes": 33_700_000,
        "loss250Kes": 41_200_000,
        "cluster": "Mathare Basin",
        "aiFlagged": True,
        "sourceTag": "synthetic",
    },
    {
        "id": "NBO-0218",
        "portfolioId": "SYN-PORT-142",
        "name": "South C · Popo Road",
        "region": "South C",
        "latitude": -1.3172,
        "longitude": 36.8252,
        "housingClass": "permanent_masonry",
        "floorAreaM2": 344.0,
        "costPerM2Kes": 140988.37,
        "insuredValueKes": 48_500_000,
        "hazardScore": 0.74,
        "hazardBand": "high",
        "annualFloodProbability": 0.10,
        "aalKes": 2_760_000,
        "loss100Kes": 18_500_000,
        "loss250Kes": 23_100_000,
        "cluster": "Nairobi South",
        "aiFlagged": False,
        "sourceTag": "synthetic",
    },
    {
        "id": "NBO-0337",
        "portfolioId": "SYN-PORT-142",
        "name": "Kibera · Lindi",
        "region": "Kibera",
        "latitude": -1.3121,
        "longitude": 36.7893,
        "housingClass": "informal_iron_sheet",
        "floorAreaM2": 96.0,
        "costPerM2Kes": 133333.33,
        "insuredValueKes": 12_800_000,
        "hazardScore": 0.71,
        "hazardBand": "high",
        "annualFloodProbability": 0.10,
        "aalKes": 1_420_000,
        "loss100Kes": 9_200_000,
        "loss250Kes": 10_800_000,
        "cluster": "Kibera Drainage",
        "aiFlagged": True,
        "sourceTag": "synthetic",
    },
]

CLUSTERS = [
    {"id": "CLU-MATHARE", "name": "Mathare Basin", "type": "neighbourhood", "propertyCount": 74, "insuredValueKes": 638_000_000, "loss100Kes": 211_000_000, "aalPercentTiv": 4.8, "annualFloodProbability": 0.24, "portfolioLossShare": 0.17, "riskBand": "severe", "classMix": {"informal": 0.58, "semiPermanent": 0.29, "masonry": 0.13}, "hotspotFlag": True, "accumulationFlag": "high_value_high_hazard"},
    {"id": "CLU-KIBERA", "name": "Kibera Drainage", "type": "neighbourhood", "propertyCount": 96, "insuredValueKes": 514_000_000, "loss100Kes": 184_000_000, "aalPercentTiv": 5.1, "annualFloodProbability": 0.19, "portfolioLossShare": 0.15, "riskBand": "high", "classMix": {"informal": 0.64, "semiPermanent": 0.25, "masonry": 0.11}, "hotspotFlag": True, "accumulationFlag": "ai_hotspot_uplift"},
    {"id": "CLU-INDUSTRIAL", "name": "Industrial East", "type": "neighbourhood", "propertyCount": 61, "insuredValueKes": 892_000_000, "loss100Kes": 163_000_000, "aalPercentTiv": 2.4, "annualFloodProbability": 0.08, "portfolioLossShare": 0.13, "riskBand": "moderate", "classMix": {"informal": 0.12, "semiPermanent": 0.20, "masonry": 0.68}, "hotspotFlag": False, "accumulationFlag": "value_concentration"},
]

STAGES = [
    ("data_validation", "Data validation"),
    ("hazard_modelling", "Hazard modelling"),
    ("vulnerability_mapping", "Vulnerability mapping"),
    ("exposure_join", "Exposure join"),
    ("financial_loss", "Financial loss engine"),
    ("ai_intelligence", "AI intelligence"),
    ("human_review", "Human review gate"),
    ("publish", "Approved model run"),
]

RUNS = {}
CHATS = {}
run_counter = count(143)
chat_counter = count(1)


def portfolio_summary(portfolio_id: str) -> dict:
    return {
        "portfolioId": portfolio_id,
        "name": "Nairobi Synthetic Flood Portfolio",
        "status": "draft",
        "totalInsuredValueKes": 4_820_000_000,
        "propertyCount": 600,
        "portfolioAalKes": 126_400_000,
        "aalPercentTiv": 2.62,
        "loss100Kes": 895_500_000,
        "highRiskValueKes": 1_850_000_000,
        "highRiskValueShare": 0.384,
        "aiFlaggedCount": 47,
        "sourceTag": "synthetic",
        "asOf": now_iso(),
    }


def list_properties(portfolio_id: str, filters: dict) -> dict:
    items = [item for item in PROPERTIES if item["portfolioId"] == portfolio_id]
    query = (filters.get("q") or "").lower()
    if query:
        items = [item for item in items if query in f'{item["id"]} {item["name"]} {item["region"]}'.lower()]
    hazard_band = filters.get("hazardBand")
    if hazard_band:
        allowed = set(hazard_band.lower().split(","))
        items = [item for item in items if item["hazardBand"] in allowed]
    housing_class = filters.get("housingClass")
    if housing_class:
        items = [item for item in items if item["housingClass"] == housing_class]
    if str(filters.get("aiFlagged", "")).lower() == "true":
        items = [item for item in items if item["aiFlagged"]]
    return {"items": deepcopy(items), "total": len(items), "nextCursor": None, "dummy": True}


def property_detail(property_id: str) -> dict | None:
    property_record = next((item for item in PROPERTIES if item["id"] == property_id), None)
    if not property_record:
        return None
    record = deepcopy(property_record)
    score = record["hazardScore"]
    return {
        "identity": {key: record[key] for key in ("id", "portfolioId", "name", "region", "latitude", "longitude", "housingClass", "sourceTag")},
        "exposure": {"floorAreaM2": record["floorAreaM2"], "costPerM2Kes": record["costPerM2Kes"], "insuredValueKes": record["insuredValueKes"], "sourceTag": "synthetic"},
        "hazard": {
            "score": score,
            "band": record["hazardBand"],
            "annualFloodProbability": record["annualFloodProbability"],
            "tiers": [
                {"name": "2-year", "score": max(0.08, score - 0.46), "depthM": round(max(0.08, score - 0.46) * 0.35, 2)},
                {"name": "10-year", "score": max(0.16, score - 0.27), "depthM": round(max(0.16, score - 0.27) * 0.8, 2)},
                {"name": "25-year", "score": max(0.24, score - 0.15), "depthM": round(max(0.24, score - 0.15) * 1.2, 2)},
                {"name": "100-year", "score": score, "depthM": round(score * 1.8, 2)},
                {"name": "250-year", "score": min(0.99, score + 0.08), "depthM": round(min(0.99, score + 0.08) * 2.4, 2)},
            ],
            "drivers": {"elevation": 0.78, "depressions": 0.62, "slope": 0.44, "riverDistance": 0.71, "aiUplift": 0.66 if record["aiFlagged"] else 0.12},
            "nearestHotspot": {"name": "Dummy hotspot", "distanceKm": 0.4},
            "sourceTag": "proxy",
        },
        "loss": {
            "aalKes": record["aalKes"],
            "aalPerMilleTiv": round(record["aalKes"] / record["insuredValueKes"] * 1000, 2),
            "loss10Kes": round(record["loss100Kes"] * 0.36, 2),
            "loss100Kes": record["loss100Kes"],
            "loss250Kes": record["loss250Kes"],
            "portfolioLoss100Share": round(record["loss100Kes"] / 895_500_000, 5),
            "epCurve": [{"returnPeriodYears": period, "lossKes": loss} for period, loss in [(2, record["loss100Kes"] * 0.08), (10, record["loss100Kes"] * 0.36), (25, record["loss100Kes"] * 0.58), (100, record["loss100Kes"]), (250, record["loss250Kes"])]],
            "sourceTag": "modelled_dummy",
        },
        "explainability": {"summary": "Dummy explanation. Replace with the model explanation service.", "warnings": ["Prototype hazard and loss values"], "provenance": ["synthetic exposure", "proxy hazard", "assumed vulnerability"]},
        "portfolioContext": {"aalRank": "Top 8%", "cluster": record["cluster"], "propertiesWithin500m": 36, "localInsuredValueKes": 198_000_000},
        "dummy": True,
    }


def create_property(portfolio_id: str, payload: dict) -> dict:
    index = len(PROPERTIES) + 601
    item = {
        "id": payload.get("id") or f"NBO-{index:04d}",
        "portfolioId": portfolio_id,
        "name": payload.get("name", "New synthetic property"),
        "region": payload.get("region", "Nairobi"),
        "latitude": payload["latitude"],
        "longitude": payload["longitude"],
        "housingClass": payload.get("housingClass", "unclassified"),
        "floorAreaM2": payload.get("floorAreaM2"),
        "costPerM2Kes": payload.get("costPerM2Kes"),
        "insuredValueKes": payload.get("insuredValueKes"),
        "hazardScore": None,
        "hazardBand": "pending",
        "annualFloodProbability": None,
        "aalKes": None,
        "loss100Kes": None,
        "loss250Kes": None,
        "cluster": "pending",
        "aiFlagged": False,
        "sourceTag": "synthetic",
    }
    PROPERTIES.append(item)
    return deepcopy(item)


def list_clusters(portfolio_id: str, cluster_type: str) -> dict:
    items = deepcopy(CLUSTERS)
    for item in items:
        item["portfolioId"] = portfolio_id
        item["type"] = cluster_type
    return {"items": items, "total": len(items), "dummy": True}


def create_model_run(payload: dict) -> dict:
    run_id = f"RUN-{next(run_counter)}"
    run = {
        "id": run_id,
        "portfolioId": payload.get("portfolioId", "SYN-PORT-142"),
        "status": "running",
        "currentStage": "data_validation",
        "configuration": payload.get("configuration", {}),
        "createdAt": now_iso(),
        "stages": [
            {"key": key, "title": title, "position": index, "status": "running" if index == 1 else "waiting", "output": None}
            for index, (key, title) in enumerate(STAGES, start=1)
        ],
        "dummy": True,
    }
    RUNS[run_id] = run
    return deepcopy(run)


def get_model_run(run_id: str) -> dict | None:
    if run_id in RUNS:
        return deepcopy(RUNS[run_id])
    if run_id == "RUN-142":
        run = create_model_run({"portfolioId": "SYN-PORT-142"})
        generated_id = run["id"]
        RUNS.pop(generated_id, None)
        run["id"] = run_id
        RUNS[run_id] = deepcopy(run)
        return run
    return None


def decide_model_run(run_id: str, action: str, comment: str | None) -> dict | None:
    run = RUNS.get(run_id)
    if not run:
        return None
    run["status"] = "approved" if action == "approve" else "revision_requested"
    run["currentStage"] = "publish" if action == "approve" else "human_review"
    return {"runId": run_id, "action": action, "comment": comment, "status": run["status"], "decidedAt": now_iso(), "dummy": True}


def cancel_model_run(run_id: str) -> dict | None:
    run = RUNS.get(run_id)
    if not run:
        return None
    run["status"] = "cancelled"
    return {"runId": run_id, "status": "cancelled", "cancelledAt": now_iso(), "dummy": True}


def model_report(run_id: str) -> dict:
    return {"id": f"REPORT-{run_id}", "runId": run_id, "status": "approved", "portfolio": portfolio_summary("SYN-PORT-142"), "downloadUrl": f"/api/v1/model-runs/{run_id}/report?format=pdf", "generatedAt": now_iso(), "dummy": True}


def chat_response(payload: dict) -> dict:
    mode = payload.get("mode", "analysis")
    if mode == "exposure":
        return gemini_service.dummy_exposure()
    return gemini_service.dummy_analysis()


def list_chats() -> dict:
    return {"items": [deepcopy(chat) for chat in CHATS.values()], "total": len(CHATS), "dummy": True}


def create_chat(payload: dict) -> dict:
    chat_id = f"CHAT-{next(chat_counter):04d}"
    chat = {"id": chat_id, "title": payload.get("title", "New analysis"), "context": payload.get("context", {}), "messages": [], "updatedAt": now_iso(), "dummy": True}
    CHATS[chat_id] = chat
    return deepcopy(chat)


def chat_messages(chat_id: str) -> list | None:
    chat = CHATS.get(chat_id)
    return deepcopy(chat["messages"]) if chat else None


def add_chat_message(chat_id: str, payload: dict) -> dict | None:
    chat = CHATS.get(chat_id)
    if not chat:
        return None
    message = {"id": f"MSG-{len(chat['messages']) + 1:04d}", "role": payload["role"], "content": payload["content"], "createdAt": now_iso()}
    chat["messages"].append(message)
    chat["updatedAt"] = now_iso()
    return deepcopy(message)
