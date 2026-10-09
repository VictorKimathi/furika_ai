"""Approved, source-labelled results for the underwriter report."""

from . import run_metrics


def build(run) -> dict:
    catalogue = run_metrics.compute(run)
    stages = catalogue["stages"]
    financial = {item["id"]: item for item in stages["financial"]["metrics"]}
    tiers = financial["FIN-18"]["data"]["tiers"]
    summary = (run.configuration or {}).get("summary", {})
    return {
        "runId": run.id,
        "portfolioId": run.portfolio_id,
        "status": run.status,
        "generatedFrom": "Approved model run and recalculated stage metrics",
        "summary": summary,
        "epCurve": [{"returnPeriodYears": row["rp"], "annualExceedanceProbability": 1 / row["rp"],
                     "groundUpKes": row["groundUpKes"], "grossKes": row["grossKes"], "netKes": row["netKes"]}
                    for row in tiers],
        "financial": {
            "lossRatio100": financial["FIN-02"]["value"],
            "affectedProperties250": financial["FIN-03"]["value"],
            "aalRangeKes": financial["FIN-05"]["data"],
            "aalByLayerKes": financial["FIN-20"]["data"],
            "lossWaterfall": tiers,
            "assumptions": financial["FIN-21"]["data"],
        },
        "stages": stages,
        "limitations": run_metrics.LIMITATIONS,
        "note": catalogue["note"],
        "emailDelivery": (run.configuration or {}).get("reportDelivery"),
        "dummy": False,
    }
