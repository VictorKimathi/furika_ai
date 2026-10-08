"""Reproducible benchmark and accuracy checks for docs/model-documentation.md.

Runs on a throwaway in-memory database built from the reference exposure file; no external
calls, and the configured database is never touched. Usage:

    PYTHONPATH=. python scripts/benchmark_models.py data/reference/exposure_nairobi_with_hazard.pdf
"""
import json, time, statistics, tempfile, shutil, sys
import numpy as np, pandas as pd
from app import create_app
from app.config import TestingConfig
from app.extensions import db
from app.models import Upload, ModelRun
from app.services import furika_model as fm, run_metrics, reference, llm, geocoding
from app.services.model_runs import _properties
from app.services.ingestion.enrichment import ReferenceData

PDF = sys.argv[1]
llm.get_llm = lambda: None
geocoding.get_geocoder = lambda: None
tmp = tempfile.mkdtemp()
class C(TestingConfig):
    STORAGE_ROOT = tmp
app = create_app(C)
out = {}
def med(fn, repeat=5):
    times = []
    for _ in range(repeat):
        t = time.perf_counter(); r = fn(); times.append(time.perf_counter() - t)
    return r, statistics.median(times)

with app.app_context():
    db.create_all(); c = app.test_client()
    t = time.perf_counter()
    body = c.post("/api/v1/portfolios/SYN-PORT-142/uploads", data={"file": (open(PDF, "rb"), "exposure.pdf"), "attestation": "synthetic"}, content_type="multipart/form-data").json
    out["t_ingest_pdf_s"] = time.perf_counter() - t
    out["ingest"] = {k: body["summary"].get(k) for k in ("rows", "byStatus", "unparsedLines", "pages", "chunks", "documentType")}
    codes = {}
    for item in c.get(f"/api/v1/uploads/{body['id']}/issues").json["items"]:
        codes[item["code"]] = codes.get(item["code"], 0) + 1
    out["issue_codes"] = codes
    upload = db.session.get(Upload, body["id"])
    out["grid_points_loaded"] = reference.load_reference_points(upload)

    props = _properties("SYN-PORT-142")
    frame = pd.DataFrame([{"loc_id": p.id, "lat": float(p.latitude), "lon": float(p.longitude), "housing_class": p.housing_class, "floor_area_m2": float(p.floor_area_m2),
                           "cost_per_m2_kes": float(p.cost_per_m2_kes), "tiv_kes": float(p.insured_value_kes), **{f"hazard_score_{t}": float(p.attributes["hazard_scores"][t]) for t in fm.TIERS}} for p in props])
    out["n_props"] = len(frame); out["classes"] = frame["housing_class"].value_counts().to_dict()
    out["tiv_by_class"] = frame.groupby("housing_class")["tiv_kes"].sum().to_dict()
    result, out["t_run_model_s"] = med(lambda: fm.run_model(frame))
    out["tier_losses"] = [{"tier": r.tier, "rp": r.rp, "loss": r.loss_kes, "ratio": r.loss_ratio, "exposed": r.exposed_tiv_kes} for r in result["tier_losses"].itertuples()]
    out["aal"] = result["aal"]; out["tiv"] = result["total_tiv_kes"]
    for rp in (10, 25, 50, 100, 250): out[f"l{rp}"] = fm.interpolate_loss(result["ep_curve"], rp)
    out["monotonic_violations"] = len(result["monotonic_violations"])
    out["validation_issue_count"] = len(result["validation_issues"])
    out["wet_count"] = {t: int((frame[f"hazard_score_{t}"] > 0).sum()) for t in fm.TIERS}
    out["loss_by_class_l250"] = result["loss_by_class"][result["loss_by_class"]["rp"] == 250].set_index("housing_class")["loss_kes"].to_dict()
    sens = {}
    for label, kw in [("dmax3", {"d_max": 3.0}), ("dmax5", {"d_max": 5.0}), ("rp_alt", {"tier_rp": fm.ALTERNATIVE_TIER_RP})]:
        r = fm.run_model(frame, **kw); sens[label] = {"l100": fm.interpolate_loss(r["ep_curve"], 100), "aal": r["aal"]["aal_central"]}
    for factor in (0.8, 1.2):
        params = {k: {**p, "dr_max": min(1.0, p["dr_max"] * factor)} for k, p in fm.DEFAULT_VULN.items()}
        r = fm.run_model(frame, vuln_params=params); sens[f"vuln{factor}"] = {"l100": fm.interpolate_loss(r["ep_curve"], 100), "aal": r["aal"]["aal_central"]}
    out["sensitivity"] = sens

    t = time.perf_counter(); run = c.post("/api/v1/model-runs", json={"portfolioId": "SYN-PORT-142"}).json; out["t_create_run_s"] = time.perf_counter() - t
    t = time.perf_counter(); c.post(f"/api/v1/model-runs/{run['id']}/decision", json={"action": "approve"}); out["t_approve_s"] = time.perf_counter() - t
    t = time.perf_counter(); m = c.get(f"/api/v1/model-runs/{run['id']}/metrics").json; out["t_metrics_s"] = time.perf_counter() - t
    t = time.perf_counter(); c.get(f"/api/v1/model-runs/{run['id']}/metrics"); out["t_metrics_cached_s"] = time.perf_counter() - t
    out["metrics_total"] = sum(len(s["metrics"]) for s in m["stages"].values())
    out["metrics_measured"] = sum(1 for s in m["stages"].values() for x in s["metrics"] if not (x["value"] is None and x["chart"] is None and x["table"] is None))
    out["metrics_unmeasured"] = [x["id"] for s in m["stages"].values() for x in s["metrics"] if x["value"] is None and x["chart"] is None and x["table"] is None]
    out["checks"] = next(x for x in m["stages"]["trust"]["metrics"] if x["id"] == "TRU-05")["table"]["rows"]
    for key, path in (("list", "/api/v1/portfolios/SYN-PORT-142/properties?limit=2000"), ("summary", "/api/v1/portfolios/SYN-PORT-142/summary"), ("clusters", "/api/v1/portfolios/SYN-PORT-142/clusters?type=grid"), ("detail", f"/api/v1/properties/{run['configuration']['summary']['topRisks'][0]['locationId']}?includeDraft=true")):
        _, out[f"t_api_{key}_s"] = med(lambda: c.get(path), repeat=3)

    ref = ReferenceData.load(); n = len(ref.point_ids); out["grid_points"] = n
    err = {t: [] for t in fm.TIERS}; wt = {t: [] for t in fm.TIERS}; wp = {t: [] for t in fm.TIERS}; near = []
    t0 = time.perf_counter()
    for i in range(n):
        keep = np.arange(n) != i
        sub = ReferenceData(point_ids=[ref.point_ids[j] for j in range(n) if keep[j]], point_lat=ref.point_lat[keep], point_lon=ref.point_lon[keep], point_scores=ref.point_scores[keep])
        pred, ev = sub.interpolate(float(ref.point_lat[i]), float(ref.point_lon[i])); near.append(ev["nearestKm"])
        for k, t in enumerate(fm.TIERS):
            truth = float(ref.point_scores[i][k]); err[t].append(abs(pred[t] - truth)); wt[t].append(truth > 0); wp[t].append(pred[t] > 0.05)
    out["t_idw_ms"] = (time.perf_counter() - t0) / n * 1000
    out["idw"] = {}
    for k, t in enumerate(fm.TIERS):
        a, b = np.array(wt[t]), np.array(wp[t])
        out["idw"][t] = {"mae": float(np.mean(err[t])), "p90": float(np.percentile(err[t], 90)), "baseline_mae": float(np.mean(np.abs(ref.point_scores[:, k] - ref.point_scores[:, k].mean()))),
                         "wet_acc": float(np.mean(a == b)), "recall": float(b[a].mean()) if a.any() else None, "precision": float(a[b].mean()) if b.any() else None, "wet_share": float(a.mean())}
    out["idw_near_median_km"] = float(np.median(near)); out["idw_within_500m"] = float(np.mean(np.array(near) <= 0.5))
shutil.rmtree(tmp)
print(json.dumps(out, indent=1, default=str))
