"""Location, hazard and plausibility enrichment for a parsed row.

`evaluate_row` is the single entry point used by uploads, review edits and manual
property creation: parse → locate (geocode if needed) → bounds → hazard lookup →
hotspots → plausibility.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field

import numpy as np

from ...models import HazardReferencePoint, Hotspot
from .. import furika_model as fm
from ..geocoding import STREET_OR_BETTER, GeocodingError
from .validation import HAZARD_FIELDS, check_bounds, check_row, issue

IDW_NEIGHBOURS = 4
IDW_POWER = 2
MAX_GRID_DISTANCE_KM = 0.5
HOTSPOT_RADIUS_KM = 3.0
COST_OUTLIER_FACTOR = 3.0
COST_MIN_POINTS = 5


@dataclass
class ReferenceData:
    point_ids: list[str] = field(default_factory=list)
    point_lat: np.ndarray = field(default_factory=lambda: np.empty(0))
    point_lon: np.ndarray = field(default_factory=lambda: np.empty(0))
    point_scores: np.ndarray = field(default_factory=lambda: np.empty((0, len(fm.TIERS))))
    cost_by_class: dict[str, tuple[float, float]] = field(default_factory=dict)
    hotspot_names: list[str] = field(default_factory=list)
    hotspot_lat: np.ndarray = field(default_factory=lambda: np.empty(0))
    hotspot_lon: np.ndarray = field(default_factory=lambda: np.empty(0))

    @classmethod
    def load(cls) -> "ReferenceData":
        points = HazardReferencePoint.query.order_by(HazardReferencePoint.id).all()
        hotspots = Hotspot.query.order_by(Hotspot.name).all()
        costs = defaultdict(list)
        for point in points:
            if point.housing_class and point.cost_per_m2_kes:
                costs[point.housing_class].append(point.cost_per_m2_kes)
        cost_by_class = {
            housing_class: (float(np.median(values)) / COST_OUTLIER_FACTOR, float(np.median(values)) * COST_OUTLIER_FACTOR)
            for housing_class, values in costs.items()
            if len(values) >= COST_MIN_POINTS
        }
        return cls(
            point_ids=[point.id for point in points],
            point_lat=np.array([point.latitude for point in points], dtype=float),
            point_lon=np.array([point.longitude for point in points], dtype=float),
            point_scores=np.array([[point.scores[tier] for tier in fm.TIERS] for point in points], dtype=float).reshape(len(points), len(fm.TIERS)),
            cost_by_class=cost_by_class,
            hotspot_names=[hotspot.name for hotspot in hotspots],
            hotspot_lat=np.array([hotspot.latitude for hotspot in hotspots], dtype=float),
            hotspot_lon=np.array([hotspot.longitude for hotspot in hotspots], dtype=float),
        )

    def interpolate(self, lat: float, lon: float) -> tuple[dict[str, float], dict] | None:
        """Inverse-distance-weighted scores from the nearest reference points."""
        if not self.point_ids:
            return None
        distances = fm.haversine_km(self.point_lat, self.point_lon, lat, lon)
        nearest = np.argsort(distances)[:IDW_NEIGHBOURS]
        if distances[nearest[0]] < 1e-6:
            scores = self.point_scores[nearest[0]]
            used = nearest[:1]
        else:
            weights = 1 / distances[nearest] ** IDW_POWER
            scores = weights @ self.point_scores[nearest] / weights.sum()
            used = nearest
        evidence = {
            "method": f"inverse-distance weighting (k={IDW_NEIGHBOURS}, power={IDW_POWER})",
            "nearestKm": round(float(distances[nearest[0]]), 3),
            "points": [{"id": self.point_ids[index], "distanceKm": round(float(distances[index]), 3)} for index in used],
        }
        return {tier: round(float(score), 6) for tier, score in zip(fm.TIERS, scores)}, evidence

    def hotspots_near(self, lat: float, lon: float) -> tuple[list[dict], float | None]:
        """Hotspots within HOTSPOT_RADIUS_KM (nearest first) and the distance to the nearest hotspot overall."""
        if not self.hotspot_names:
            return [], None
        distances = fm.haversine_km(self.hotspot_lat, self.hotspot_lon, lat, lon)
        order = np.argsort(distances)
        near = [{"name": self.hotspot_names[index], "distanceKm": round(float(distances[index]), 3)} for index in order if distances[index] <= HOTSPOT_RADIUS_KM]
        return near, round(float(distances[order[0]]), 3)


@dataclass
class RowContext:
    reference: ReferenceData
    geocoder: object | None = None


def _locate(data: dict, issues: list[dict], filled: dict, ctx: RowContext) -> None:
    address = data.get("address")
    if not address:
        issues.append(issue("missing_required_field", "error", "lat and lon are required, or an address that can be geocoded.", "lat"))
        return
    query = ", ".join(part for part in (address, data.get("region"), "Nairobi, Kenya") if part)
    if ctx.geocoder is None:
        issues.append(issue("geocode_failed", "review", "Coordinates are missing and geocoding is not configured; add coordinates in review.", "lat", {"query": query}))
        return
    try:
        result = ctx.geocoder.geocode(query)
    except GeocodingError as exc:
        issues.append(issue("geocode_failed", "review", f"Geocoding failed: {exc}", "lat", {"query": query}))
        return
    if result is None:
        issues.append(issue("geocode_failed", "review", "The address could not be geocoded; add coordinates in review.", "lat", {"query": query}))
        return
    data["lat"], data["lon"] = result.lat, result.lon
    data["geocode"] = result.as_dict() | {"query": query}
    for name in ("lat", "lon"):
        filled[name] = {"method": "geocoded", "raw_value": query, "quote": result.formatted_address}
    if result.precision not in STREET_OR_BETTER:
        issues.append(issue(
            "approximate_location", "review",
            f"The address only resolved to {result.precision} level ({result.formatted_address}); confirm or correct the location.",
            "lat", {"query": query, "precision": result.precision, "formattedAddress": result.formatted_address},
        ))


def _lookup_hazard(data: dict, issues: list[dict], filled: dict, ctx: RowContext) -> None:
    looked_up = ctx.reference.interpolate(data["lat"], data["lon"])
    if looked_up is None:
        data["hazard"] = {"source": "missing"}
        issues.append(issue("hazard_missing", "warning", "No hazard scores were supplied and no reference grid is loaded; the property is excluded from model runs.", None))
        return
    scores, evidence = looked_up
    for tier, score in scores.items():
        data[f"hazard_score_{tier}"] = score
        filled[f"hazard_score_{tier}"] = {"method": "lookup", "quote": f"{evidence['method']} from {', '.join(point['id'] for point in evidence['points'])}"}
    data["hazard"] = {"source": "interpolated", **evidence}
    if evidence["nearestKm"] > MAX_GRID_DISTANCE_KM:
        issues.append(issue(
            "hazard_far_from_grid", "review",
            f"The nearest scored reference point is {evidence['nearestKm']:.2f} km away; interpolated hazard may not represent this location.",
            None, evidence,
        ))


def evaluate_row(raw: dict[str, str | None], ctx: RowContext) -> tuple[dict, list[dict], dict[str, dict]]:
    data, issues, filled = check_row(raw)
    flagged = {item["field"] for item in issues}

    if data["lat"] is None and data["lon"] is None and not {"lat", "lon"} & flagged:
        _locate(data, issues, filled, ctx)
    located = data["lat"] is not None and data["lon"] is not None
    if located:
        bounds_issues = check_bounds(data)
        issues.extend(bounds_issues)
        located = not bounds_issues

    hazard_given = any(data[name] is not None for name in HAZARD_FIELDS) or bool(set(HAZARD_FIELDS) & flagged)
    if hazard_given:
        data["hazard"] = {"source": "supplied"}
    elif located:
        _lookup_hazard(data, issues, filled, ctx)
    else:
        data["hazard"] = {"source": "missing"}

    data["hotspots"], data["nearestHotspotKm"] = ctx.reference.hotspots_near(data["lat"], data["lon"]) if located else ([], None)

    cost_range = ctx.reference.cost_by_class.get(data["housing_class"])
    cost = data["cost_per_m2_kes"]
    if cost_range and cost and not cost_range[0] <= cost <= cost_range[1]:
        issues.append(issue(
            "cost_outlier", "warning",
            f"cost_per_m2_kes {cost:,.0f} is outside {cost_range[0]:,.0f}–{cost_range[1]:,.0f} for {data['housing_class']} in the reference data.",
            "cost_per_m2_kes", {"value": cost, "low": cost_range[0], "high": cost_range[1]},
        ))
    return data, issues, filled
