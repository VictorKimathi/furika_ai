"""Server-side geocoding through the Google Geocoding REST API.

Uses GOOGLE_MAPS_API_KEY (a server key, separate from the browser Maps key). Results are
biased to Kenya and the Nairobi bounds, and every result carries a precision so callers
can flag approximate locations.
"""

from __future__ import annotations

import json
import os
import urllib.parse
import urllib.request
from dataclasses import dataclass

from . import furika_model as fm

GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json"
STREET_OR_BETTER = {"rooftop", "street"}
STREET_TYPES = {"street_address", "premise", "subpremise", "route", "intersection", "establishment", "point_of_interest"}
NEIGHBOURHOOD_TYPES = {"neighborhood", "sublocality", "sublocality_level_1", "sublocality_level_2", "postal_code"}
CITY_TYPES = {"locality", "administrative_area_level_2", "administrative_area_level_3"}


class GeocodingError(RuntimeError):
    pass


@dataclass
class GeocodeResult:
    lat: float
    lon: float
    formatted_address: str
    precision: str
    provider: str = "google"

    def as_dict(self) -> dict:
        return {"formattedAddress": self.formatted_address, "latitude": self.lat, "longitude": self.lon, "precision": self.precision, "provider": self.provider}


def classify_precision(location_type: str, types: list[str]) -> str:
    if location_type == "ROOFTOP":
        return "rooftop"
    if location_type == "RANGE_INTERPOLATED":
        return "street"
    kinds = set(types)
    if kinds & STREET_TYPES:
        return "street"
    if kinds & NEIGHBOURHOOD_TYPES:
        return "neighbourhood"
    if kinds & CITY_TYPES:
        return "city"
    return "region"


class GoogleGeocoder:
    def __init__(self, api_key: str, timeout: float = 10.0):
        self.api_key = api_key
        self.timeout = timeout
        self._cache: dict[str, GeocodeResult | None] = {}

    def geocode(self, query: str) -> GeocodeResult | None:
        """Return the best match, None for no match. Raises GeocodingError on API failure."""
        key = query.strip().lower()
        if key in self._cache:
            return self._cache[key]
        bounds = fm.NAIROBI_BOUNDS
        params = urllib.parse.urlencode({
            "address": query,
            "components": "country:KE",
            "bounds": f"{bounds['lat_min']},{bounds['lon_min']}|{bounds['lat_max']},{bounds['lon_max']}",
            "region": "ke",
            "key": self.api_key,
        })
        try:
            with urllib.request.urlopen(f"{GEOCODE_URL}?{params}", timeout=self.timeout) as response:
                payload = json.load(response)
        except OSError as exc:
            raise GeocodingError(f"Geocoding request failed: {exc}") from exc
        status = payload.get("status")
        if status == "ZERO_RESULTS":
            self._cache[key] = None
            return None
        if status != "OK":
            raise GeocodingError(f"Google Geocoding returned {status}: {payload.get('error_message', '')}".strip())
        best = payload["results"][0]
        location = best["geometry"]["location"]
        result = GeocodeResult(
            lat=float(location["lat"]),
            lon=float(location["lng"]),
            formatted_address=best.get("formatted_address", query),
            precision=classify_precision(best["geometry"].get("location_type", ""), best.get("types", [])),
        )
        self._cache[key] = result
        return result


def get_geocoder() -> GoogleGeocoder | None:
    key = os.getenv("GOOGLE_MAPS_API_KEY", "")
    return GoogleGeocoder(key) if key else None
