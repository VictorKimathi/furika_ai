"""Auditable deterministic flood catastrophe calculations.

No machine learning is used here. AI may supply reviewed inputs, but every
hazard, vulnerability, loss, EP and AAL calculation is deterministic.
"""

from __future__ import annotations

import math
from collections.abc import Iterable, Mapping

import numpy as np
import pandas as pd


TIERS = ["common", "occasional", "moderate", "severe", "extreme"]
RP_ORDER = ["extreme", "severe", "moderate", "occasional", "common"]
DEFAULT_TIER_RP = {
    "extreme": 10,
    "severe": 25,
    "moderate": 50,
    "occasional": 100,
    "common": 250,
}
ALTERNATIVE_TIER_RP = {
    "extreme": 2,
    "severe": 10,
    "moderate": 25,
    "occasional": 100,
    "common": 250,
}
DEFAULT_D_MAX = 4.0
DEFAULT_WET_THRESHOLD = 0.0
NAIROBI_BOUNDS = {"lat_min": -1.50, "lat_max": -1.10, "lon_min": 36.60, "lon_max": 37.10}
VALID_CLASSES = ("informal_iron_sheet", "semi_permanent", "permanent_masonry", "concrete_rcc")
REQUIRED_EXPOSURE_COLUMNS = [
    "loc_id",
    "lat",
    "lon",
    "housing_class",
    "floor_area_m2",
    "cost_per_m2_kes",
    "tiv_kes",
    *[f"hazard_score_{tier}" for tier in TIERS],
]

# Placeholder assumptions. These must later be calibrated and documented
# against the selected JRC/Huizinga reference table.
DEFAULT_VULN = {
    "informal_iron_sheet": {"dr_max": 0.95, "d50": 0.55, "k": 3.5},
    "semi_permanent": {"dr_max": 0.85, "d50": 0.80, "k": 3.0},
    "permanent_masonry": {"dr_max": 0.65, "d50": 1.20, "k": 2.4},
    # Engineered reinforced concrete: relative vulnerability 0.6 of masonry (prototype weights RCC 0.30 vs masonry 0.50),
    # later onset and a gentler slope. Contents and basement plant are not modelled separately.
    "concrete_rcc": {"dr_max": 0.39, "d50": 1.60, "k": 2.2},
}


def validate_tier_rp(tier_rp: Mapping[str, float]) -> list[str]:
    """Return issues; a valid mapping is strictly increasing with rarity."""
    issues = []
    missing = [tier for tier in TIERS if tier not in tier_rp]
    if missing:
        return [f"Missing return periods for: {', '.join(missing)}"]
    values = [tier_rp[tier] for tier in RP_ORDER]
    if any(not isinstance(value, (int, float)) or value <= 1 for value in values):
        issues.append("Return periods must be numeric and greater than one year.")
    if any(right <= left for left, right in zip(values, values[1:])):
        issues.append("Return periods must increase from extreme to common because the tier names run opposite to rarity.")
    return issues


def validate_vuln_params(params: Mapping[str, Mapping[str, float]]) -> list[str]:
    """Validate parameter domains and class ordering over representative depths."""
    issues = []
    for housing_class in VALID_CLASSES:
        if housing_class not in params:
            issues.append(f"Missing vulnerability parameters for {housing_class}.")
            continue
        values = params[housing_class]
        if not 0 < values.get("dr_max", 0) <= 1:
            issues.append(f"{housing_class}.dr_max must be in (0, 1].")
        if values.get("d50", -1) < 0:
            issues.append(f"{housing_class}.d50 must be non-negative.")
        if values.get("k", 0) <= 0:
            issues.append(f"{housing_class}.k must be positive.")
    if issues:
        return issues
    depths = np.linspace(0, 8, 161)
    curves = {housing_class: damage_ratio(depths, [housing_class] * len(depths), params) for housing_class in VALID_CLASSES}
    if np.any(curves["informal_iron_sheet"] + 1e-12 < curves["semi_permanent"]):
        issues.append("Informal vulnerability must not fall below semi-permanent vulnerability.")
    if np.any(curves["semi_permanent"] + 1e-12 < curves["permanent_masonry"]):
        issues.append("Semi-permanent vulnerability must not fall below masonry vulnerability.")
    if np.any(curves["permanent_masonry"] + 1e-12 < curves["concrete_rcc"]):
        issues.append("Masonry vulnerability must not fall below reinforced-concrete vulnerability.")
    return issues


def validate_exposure(data: pd.DataFrame, tiv_tolerance: float = 0.02) -> tuple[pd.DataFrame, list[str]]:
    """Validate exposure without silently changing supplied insured values."""
    frame = data.copy()
    issues: list[str] = []
    missing = [column for column in REQUIRED_EXPOSURE_COLUMNS if column not in frame.columns]
    if missing:
        return frame, [f"Missing required columns: {', '.join(missing)}"]

    numeric_columns = ["lat", "lon", "floor_area_m2", "cost_per_m2_kes", "tiv_kes", *[f"hazard_score_{tier}" for tier in TIERS]]
    for column in numeric_columns:
        converted = pd.to_numeric(frame[column], errors="coerce")
        invalid = int(converted.isna().sum())
        if invalid:
            issues.append(f"{column}: {invalid} non-numeric or missing value(s).")
        frame[column] = converted

    duplicate_count = int(frame["loc_id"].duplicated().sum())
    if duplicate_count:
        issues.append(f"loc_id must be unique; found {duplicate_count} duplicate(s).")
    invalid_classes = sorted(set(frame["housing_class"].dropna()) - set(VALID_CLASSES))
    if invalid_classes:
        issues.append(f"Invalid housing_class value(s): {', '.join(invalid_classes)}.")
    if (frame[["floor_area_m2", "cost_per_m2_kes", "tiv_kes"]].le(0).any(axis=1)).any():
        issues.append("Floor area, cost per square metre, and TIV must be positive.")
    outside = ~(
        frame["lat"].between(NAIROBI_BOUNDS["lat_min"], NAIROBI_BOUNDS["lat_max"])
        & frame["lon"].between(NAIROBI_BOUNDS["lon_min"], NAIROBI_BOUNDS["lon_max"])
    )
    if outside.any():
        issues.append(f"{int(outside.sum())} coordinate(s) fall outside the configured Nairobi bounds.")
    for tier in TIERS:
        column = f"hazard_score_{tier}"
        invalid = ~frame[column].between(0, 1)
        if invalid.any():
            issues.append(f"{column}: {int(invalid.sum())} score(s) outside [0, 1].")
    if "synthetic" in frame.columns and not frame["synthetic"].fillna(False).astype(bool).all():
        issues.append("Every exposure row must be labelled synthetic=TRUE.")

    calculated_tiv = frame["floor_area_m2"] * frame["cost_per_m2_kes"]
    valid_base = calculated_tiv > 0
    relative_error = (frame["tiv_kes"] - calculated_tiv).abs() / calculated_tiv.where(valid_base, np.nan)
    mismatches = relative_error > tiv_tolerance
    for index in frame.index[mismatches.fillna(False)]:
        ratio = frame.at[index, "tiv_kes"] / calculated_tiv.at[index]
        issues.append(
            f"{frame.at[index, 'loc_id']}: tiv_kes is {ratio:.2f}x floor_area_m2 × cost_per_m2_kes; supplied TIV retained for audit."
        )
    return frame, issues


def _sigmoid(value: np.ndarray | float) -> np.ndarray:
    array = np.asarray(value, dtype=float)
    return np.where(array >= 0, 1 / (1 + np.exp(-array)), np.exp(array) / (1 + np.exp(array)))


def damage_ratio(
    depth_m: Iterable[float] | float,
    housing_class: Iterable[str] | str,
    params: Mapping[str, Mapping[str, float]] = DEFAULT_VULN,
) -> np.ndarray:
    """Evaluate the normalized sigmoid vulnerability function by class."""
    depths = np.atleast_1d(np.asarray(depth_m, dtype=float))
    classes = np.atleast_1d(np.asarray(housing_class, dtype=object))
    if classes.size == 1 and depths.size > 1:
        classes = np.repeat(classes, depths.size)
    if depths.size != classes.size:
        raise ValueError("depth_m and housing_class must have compatible lengths")
    output = np.zeros(depths.size, dtype=float)
    for housing_type in np.unique(classes):
        if housing_type not in params:
            raise ValueError(f"Unknown housing class: {housing_type}")
        selection = classes == housing_type
        p = params[str(housing_type)]
        d = np.maximum(depths[selection], 0)
        baseline = _sigmoid(-p["k"] * p["d50"])
        normalized = (_sigmoid(p["k"] * (d - p["d50"])) - baseline) / (1 - baseline)
        output[selection] = np.clip(p["dr_max"] * normalized, 0, p["dr_max"])
    return output


def score_to_depth(score: Iterable[float] | float, d_max: float = DEFAULT_D_MAX, wet_threshold: float = DEFAULT_WET_THRESHOLD) -> np.ndarray:
    if d_max <= 0:
        raise ValueError("d_max must be positive")
    scores = np.clip(np.asarray(score, dtype=float), 0, 1)
    depths = scores * d_max
    return np.where(depths < wet_threshold, 0.0, depths)


def haversine_km(lat1, lon1, lat2, lon2):
    """Vector-friendly great-circle distance in kilometres."""
    lat1, lon1, lat2, lon2 = map(np.radians, (lat1, lon1, lat2, lon2))
    dlat, dlon = lat2 - lat1, lon2 - lon1
    a = np.sin(dlat / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin(dlon / 2) ** 2
    return 2 * 6371.0 * np.arcsin(np.sqrt(np.clip(a, 0, 1)))


def hotspot_uplift(
    exposure: pd.DataFrame,
    hotspots: pd.DataFrame,
    radius_km: float = 1.0,
    minimum: float = 0.01,
) -> np.ndarray:
    """Calculate the distance-decayed hotspot boost u(i)."""
    if hotspots is None or hotspots.empty:
        return np.zeros(len(exposure))
    if radius_km <= 0:
        raise ValueError("radius_km must be positive")
    severity_weights = {"low": 0.10, "medium": 0.20, "high": 0.30}
    uplift = np.zeros(len(exposure), dtype=float)
    for hotspot in hotspots.itertuples(index=False):
        weight = getattr(hotspot, "weight", None)
        if weight is None:
            weight = severity_weights.get(str(getattr(hotspot, "severity", "medium")).lower(), 0.20)
        distance = haversine_km(exposure["lat"].to_numpy(), exposure["lon"].to_numpy(), hotspot.lat, hotspot.lon)
        uplift += float(weight) * np.exp(-distance / radius_km)
    return np.where(uplift >= minimum, uplift, 0.0)


def monotonic_score_violations(data: pd.DataFrame) -> list[dict]:
    columns = [f"hazard_score_{tier}" for tier in RP_ORDER]
    values = data[columns].to_numpy(dtype=float)
    bad = np.any(np.diff(values, axis=1) < -1e-12, axis=1)
    return [
        {"loc_id": data.iloc[index]["loc_id"], "scoresByIncreasingRp": values[index].tolist()}
        for index in np.flatnonzero(bad)
    ]


def build_ep_curve(loss_by_rp: pd.DataFrame) -> pd.DataFrame:
    """Build occurrence EP points with the explicit RP=1, loss=0 anchor."""
    required = {"rp", "loss_kes"}
    if not required.issubset(loss_by_rp.columns):
        raise ValueError("loss_by_rp requires rp and loss_kes columns")
    curve = loss_by_rp[["rp", "loss_kes"]].copy()
    curve["rp"] = pd.to_numeric(curve["rp"], errors="raise")
    curve["loss_kes"] = pd.to_numeric(curve["loss_kes"], errors="raise")
    curve = curve.groupby("rp", as_index=False)["loss_kes"].sum().sort_values("rp")
    if (curve["rp"] <= 1).any():
        curve = curve[curve["rp"] > 1]
    curve = pd.concat([pd.DataFrame([{"rp": 1.0, "loss_kes": 0.0}]), curve], ignore_index=True)
    curve["probability"] = 1.0 / curve["rp"]
    return curve.sort_values("rp").reset_index(drop=True)


def interpolate_loss(ep_curve: pd.DataFrame, return_period: float) -> float:
    """Interpolate linearly in log(RP); hold the rare-event tail flat."""
    if return_period < 1:
        raise ValueError("return_period must be at least one year")
    curve = ep_curve.sort_values("rp")
    if return_period >= curve.iloc[-1]["rp"]:
        return float(curve.iloc[-1]["loss_kes"])
    if return_period <= curve.iloc[0]["rp"]:
        return float(curve.iloc[0]["loss_kes"])
    upper_index = int(np.searchsorted(curve["rp"].to_numpy(), return_period, side="right"))
    lower, upper = curve.iloc[upper_index - 1], curve.iloc[upper_index]
    fraction = (math.log(return_period) - math.log(lower.rp)) / (math.log(upper.rp) - math.log(lower.rp))
    return float(lower.loss_kes + (upper.loss_kes - lower.loss_kes) * fraction)


def compute_aal(ep_curve: pd.DataFrame) -> dict[str, float]:
    """Return anchor-sensitive AAL bounds and a transparent midpoint."""
    curve = ep_curve.sort_values("probability", ascending=False)
    probabilities = curve["probability"].to_numpy(dtype=float)
    losses = curve["loss_kes"].to_numpy(dtype=float)
    trapz = float(np.sum((probabilities[:-1] - probabilities[1:]) * (losses[:-1] + losses[1:]) / 2))
    tail = float(probabilities[-1] * losses[-1])
    return {
        "aal_low": trapz,
        "aal_central": trapz + tail / 2,
        "aal_high": trapz + tail,
        "aal_trapezoid": trapz,
        "aal_tail": tail,
    }


def validate_hotspots(exposure: pd.DataFrame, hotspots: pd.DataFrame, threshold: float = 0.0) -> dict:
    """Use nearest attached property scores as a transparent prototype sampler."""
    if hotspots is None or hotspots.empty:
        return {"hotspotCount": 0, "hits": 0, "hitRate": None, "threshold": threshold, "method": "not supplied"}
    hits = 0
    details = []
    for hotspot in hotspots.itertuples(index=False):
        distances = haversine_km(exposure["lat"].to_numpy(), exposure["lon"].to_numpy(), hotspot.lat, hotspot.lon)
        nearest_index = int(np.argmin(distances))
        score = float(exposure.iloc[nearest_index][[f"hazard_score_{tier}" for tier in TIERS]].max())
        hit = score > threshold
        hits += int(hit)
        details.append({"name": hotspot.name, "nearestProperty": exposure.iloc[nearest_index]["loc_id"], "distanceKm": float(distances[nearest_index]), "score": score, "hit": hit})
    return {"hotspotCount": len(hotspots), "hits": hits, "hitRate": hits / len(hotspots), "threshold": threshold, "method": "nearest attached property score", "details": details}


def local_accumulation(exposure: pd.DataFrame, radius_km: float = 0.5) -> pd.DataFrame:
    """Return property count and TIV within the accumulation radius."""
    rows = []
    for property_row in exposure.itertuples(index=False):
        distance = haversine_km(exposure["lat"].to_numpy(), exposure["lon"].to_numpy(), property_row.lat, property_row.lon)
        inside = distance <= radius_km
        rows.append({"loc_id": property_row.loc_id, "properties_within_radius": int(inside.sum()), "tiv_local_kes": float(exposure.loc[inside, "tiv_kes"].sum()), "radius_km": radius_km})
    return pd.DataFrame(rows)


def run_model(
    exposure: pd.DataFrame,
    *,
    tier_rp: Mapping[str, float] = DEFAULT_TIER_RP,
    d_max: float = DEFAULT_D_MAX,
    wet_threshold: float = DEFAULT_WET_THRESHOLD,
    vuln_params: Mapping[str, Mapping[str, float]] = DEFAULT_VULN,
    hotspots: pd.DataFrame | None = None,
    apply_uplift: bool = False,
    uplift_radius_km: float = 1.0,
) -> dict:
    """Run property-to-portfolio loss calculations and build the EP/AAL output."""
    rp_issues = validate_tier_rp(tier_rp)
    vulnerability_issues = validate_vuln_params(vuln_params)
    if rp_issues or vulnerability_issues:
        raise ValueError(" ".join(rp_issues + vulnerability_issues))
    clean, validation_issues = validate_exposure(exposure)
    # A supplied TIV reconciliation difference is an auditable warning: the
    # insurer's value is retained. Every other exposure validation issue would
    # make the deterministic calculation unsafe and therefore stops the run.
    fatal = [issue for issue in validation_issues if "tiv_kes is" not in issue]
    if fatal:
        raise ValueError(" ".join(fatal))

    monotonic_violations = monotonic_score_violations(clean)
    uplift = hotspot_uplift(clean, hotspots, uplift_radius_km) if apply_uplift and hotspots is not None else np.zeros(len(clean))
    loss_frames = []
    for tier in TIERS:
        raw_score = clean[f"hazard_score_{tier}"].to_numpy(dtype=float)
        adjusted_score = np.minimum(1.0, raw_score + uplift)
        depth = score_to_depth(adjusted_score, d_max, wet_threshold)
        ratio = damage_ratio(depth, clean["housing_class"].to_numpy(), vuln_params)
        frame = pd.DataFrame({
            "loc_id": clean["loc_id"].to_numpy(),
            "tier": tier,
            "rp": float(tier_rp[tier]),
            "hazard_score": raw_score,
            "uplift": uplift,
            "adjusted_score": adjusted_score,
            "depth_m": depth,
            "housing_class": clean["housing_class"].to_numpy(),
            "tiv_kes": clean["tiv_kes"].to_numpy(dtype=float),
            "damage_ratio": ratio,
            "loss_kes": ratio * clean["tiv_kes"].to_numpy(dtype=float),
        })
        loss_frames.append(frame)
    losses = pd.concat(loss_frames, ignore_index=True).sort_values(["loc_id", "rp"]).reset_index(drop=True)
    tier_losses = losses.groupby(["tier", "rp"], as_index=False).agg(loss_kes=("loss_kes", "sum"), exposed_tiv_kes=("tiv_kes", lambda values: float(values[losses.loc[values.index, "depth_m"] > 0].sum())))
    tier_losses = tier_losses.sort_values("rp").reset_index(drop=True)
    total_tiv = float(clean["tiv_kes"].sum())
    tier_losses["loss_ratio"] = tier_losses["loss_kes"] / total_tiv
    ep_curve = build_ep_curve(tier_losses[["rp", "loss_kes"]])
    aal = compute_aal(ep_curve)
    first_flood = losses[losses["depth_m"] > 0].groupby("loc_id", as_index=False)["rp"].min().rename(columns={"rp": "rp_first"})
    first_flood["p_flood"] = 1 / first_flood["rp_first"]
    by_class = losses.groupby(["tier", "rp", "housing_class"], as_index=False)["loss_kes"].sum()
    return {
        "validation_issues": validation_issues,
        "monotonic_violations": monotonic_violations,
        "total_tiv_kes": total_tiv,
        "depths": losses[["loc_id", "tier", "rp", "hazard_score", "uplift", "adjusted_score", "depth_m"]].copy(),
        "losses": losses,
        "tier_losses": tier_losses,
        "loss_by_class": by_class,
        "ep_curve": ep_curve,
        "aal": aal,
        "aal_percent_tiv": aal["aal_central"] / total_tiv if total_tiv else None,
        "flood_probability": first_flood,
        "local_accumulation": local_accumulation(clean),
        "hotspot_validation": validate_hotspots(clean, hotspots),
        "assumptions": {"tier_rp": dict(tier_rp), "d_max_m": d_max, "wet_threshold_m": wet_threshold, "rare_tail": "held flat", "annual_anchor": {"rp": 1, "loss_kes": 0}},
    }


def sensitivity_runs(exposure: pd.DataFrame, hotspots: pd.DataFrame | None = None) -> pd.DataFrame:
    """One-at-a-time D_max sensitivity for L(100) and central AAL."""
    rows = []
    for d_max in (3.0, 4.0, 5.0):
        output = run_model(exposure, d_max=d_max, hotspots=hotspots)
        rows.append({"parameter": "d_max_m", "value": d_max, "loss100_kes": interpolate_loss(output["ep_curve"], 100), "aal_central_kes": output["aal"]["aal_central"]})
    return pd.DataFrame(rows)
