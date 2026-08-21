from __future__ import annotations

import hashlib
import json
import math
import re
from dataclasses import dataclass
from typing import Iterable
from urllib.parse import urlencode
from urllib.request import Request, urlopen


@dataclass(frozen=True)
class Place:
    name: str
    latitude: float
    longitude: float

    @property
    def coordinate(self) -> list[float]:
        return [self.longitude, self.latitude]


KNOWN_PLACES: dict[str, Place] = {
    "ras tanura": Place("Ras Tanura, Saudi Arabia", 26.6400, 50.1600),
    "saudi arabia": Place("Ras Tanura, Saudi Arabia", 26.6400, 50.1600),
    "fujairah": Place("Fujairah, UAE", 25.1288, 56.3265),
    "jebel ali": Place("Jebel Ali, UAE", 24.9857, 55.0272),
    "dubai": Place("Jebel Ali, UAE", 24.9857, 55.0272),
    "mumbai": Place("Mumbai, India", 18.9388, 72.8354),
    "nhava sheva": Place("Nhava Sheva, India", 18.9497, 72.9512),
    "mundra": Place("Mundra, India", 22.7432, 69.7005),
    "jamnagar": Place("Jamnagar, India", 22.4707, 70.0577),
    "kochi": Place("Kochi, India", 9.9688, 76.2442),
    "chennai": Place("Chennai, India", 13.0827, 80.2707),
    "visakhapatnam": Place("Visakhapatnam, India", 17.6868, 83.2185),
    "singapore": Place("Singapore Port", 1.2644, 103.8200),
    "shanghai": Place("Shanghai Port, China", 31.2304, 121.4737),
    "rotterdam": Place("Port of Rotterdam, Netherlands", 51.9496, 4.1453),
    "houston": Place("Port of Houston, USA", 29.7300, -95.2700),
    "jeddah": Place("Jeddah Islamic Port, Saudi Arabia", 21.4858, 39.1734),
    "colombo": Place("Port of Colombo, Sri Lanka", 6.9413, 79.8429),
    "salalah": Place("Port of Salalah, Oman", 16.9564, 54.0088),
}


def _normalise(value: str) -> str:
    return re.sub(r"[^a-z0-9 ]+", " ", value.lower()).strip()


def resolve_place(query: str) -> Place:
    cleaned = _normalise(query)
    if not cleaned:
        raise ValueError("Enter both an origin and destination.")

    for key, place in KNOWN_PLACES.items():
        if key in cleaned or cleaned in key:
            return place

    params = urlencode({"q": query, "format": "jsonv2", "limit": 1})
    request = Request(
        f"https://nominatim.openstreetmap.org/search?{params}",
        headers={"User-Agent": "LogiRiskAI/2.0 (route-resilience-demo)"},
    )
    try:
        with urlopen(request, timeout=6) as response:  # noqa: S310 - fixed host
            results = json.loads(response.read().decode("utf-8"))
        if results:
            first = results[0]
            return Place(
                first.get("display_name", query),
                float(first["lat"]),
                float(first["lon"]),
            )
    except (OSError, ValueError, KeyError, json.JSONDecodeError):
        pass

    raise ValueError(
        f"Could not locate ‘{query}’. Try a major port or city such as Fujairah, Mumbai, Singapore, or Rotterdam."
    )


def _shortest_longitude_delta(start: float, end: float) -> float:
    return (end - start + 540.0) % 360.0 - 180.0


def _wrap_longitude(value: float) -> float:
    return (value + 540.0) % 360.0 - 180.0


def curved_corridor(
    start: Iterable[float],
    end: Iterable[float],
    bend: float,
    points: int = 140,
) -> list[list[float]]:
    start_lon, start_lat = list(start)
    end_lon, end_lat = list(end)
    delta_lon = _shortest_longitude_delta(start_lon, end_lon)
    delta_lat = end_lat - start_lat
    latitude_scale = max(0.3, math.cos(math.radians((start_lat + end_lat) / 2)))
    scaled_x = delta_lon * latitude_scale
    magnitude = max(0.001, math.hypot(scaled_x, delta_lat))
    normal_x = -delta_lat / magnitude
    normal_y = scaled_x / magnitude

    coordinates: list[list[float]] = []
    for index in range(points):
        progress = index / (points - 1)
        arc = math.sin(math.pi * progress) * bend
        lon = start_lon + delta_lon * progress + (normal_x * arc / latitude_scale)
        lat = start_lat + delta_lat * progress + normal_y * arc
        coordinates.append([round(_wrap_longitude(lon), 5), round(lat, 5)])
    return coordinates


def _haversine(a: list[float], b: list[float]) -> float:
    lon1, lat1 = map(math.radians, a)
    lon2, lat2 = map(math.radians, b)
    delta_lon = lon2 - lon1
    delta_lat = lat2 - lat1
    value = (
        math.sin(delta_lat / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin(delta_lon / 2) ** 2
    )
    return 6371.0 * 2 * math.asin(min(1.0, math.sqrt(value)))


def corridor_distance(coordinates: list[list[float]]) -> int:
    return round(sum(_haversine(a, b) for a, b in zip(coordinates, coordinates[1:])))


ISSUE_TEMPLATES = [
    {
        "type": "missile",
        "title": "Missile activity corridor",
        "severity": "critical",
        "description": "Scenario intelligence indicates projectile activity near the planned corridor.",
        "action": "Maintain exclusion radius and divert traffic to the southern corridor.",
        "icon": "missile",
    },
    {
        "type": "conflict",
        "title": "Armed conflict exposure",
        "severity": "high",
        "description": "Conflict escalation may interrupt carrier movement and port access.",
        "action": "Avoid the active zone and require carrier security confirmation.",
        "icon": "blast",
    },
    {
        "type": "sanctions",
        "title": "Sanctions compliance risk",
        "severity": "high",
        "description": "Counterparty and vessel screening controls may delay this leg.",
        "action": "Screen beneficial ownership and use the cleared alternate waypoint.",
        "icon": "sanctions",
    },
    {
        "type": "port",
        "title": "Port congestion warning",
        "severity": "medium",
        "description": "Berth pressure and queue growth could extend the arrival window.",
        "action": "Reserve an alternate terminal slot before departure.",
        "icon": "port",
    },
    {
        "type": "weather",
        "title": "Severe weather watch",
        "severity": "medium",
        "description": "Forecast conditions could reduce safe operating speed in this sector.",
        "action": "Use the wider weather-routing corridor and preserve fuel margin.",
        "icon": "storm",
    },
]


def build_scenario(origin: Place, destination: Place) -> dict:
    direct_distance = _haversine(origin.coordinate, destination.coordinate)
    if direct_distance < 25:
        raise ValueError("Origin and destination are too close for corridor analysis.")

    planar_span = max(
        1.0,
        math.hypot(
            _shortest_longitude_delta(origin.longitude, destination.longitude)
            * math.cos(math.radians((origin.latitude + destination.latitude) / 2)),
            destination.latitude - origin.latitude,
        ),
    )
    primary_bend = min(3.8, max(0.45, planar_span * 0.035))
    alternate_bend = -min(8.0, max(1.8, planar_span * 0.105))
    primary = curved_corridor(origin.coordinate, destination.coordinate, primary_bend)
    alternate = curved_corridor(origin.coordinate, destination.coordinate, alternate_bend)

    seed_text = f"{origin.name}|{destination.name}"
    seed = int(hashlib.sha256(seed_text.encode()).hexdigest()[:8], 16)
    template_offset = seed % len(ISSUE_TEMPLATES)
    chosen = [
        ISSUE_TEMPLATES[0],
        ISSUE_TEMPLATES[1],
        ISSUE_TEMPLATES[2],
        ISSUE_TEMPLATES[(template_offset + 3) % len(ISSUE_TEMPLATES)],
    ]
    fractions = [0.29, 0.46, 0.63, 0.78]
    issues = []
    for index, (template, fraction) in enumerate(zip(chosen, fractions), start=1):
        coordinate = primary[round(fraction * (len(primary) - 1))]
        issues.append(
            {
                "id": f"signal-{index}",
                **template,
                "coordinate": coordinate,
                "routeProgress": fraction,
                "status": "scenario signal",
            }
        )

    primary_km = corridor_distance(primary)
    alternate_km = corridor_distance(alternate)
    speed_km_day = 690
    primary_days = round(primary_km / speed_km_day + 2.1, 1)
    alternate_days = round(alternate_km / speed_km_day + 0.8, 1)
    scenario_id = hashlib.sha1(seed_text.encode()).hexdigest()[:10].upper()  # noqa: S324

    return {
        "scenarioId": scenario_id,
        "simulated": True,
        "generatedAt": "scenario playback",
        "origin": {
            "name": origin.name,
            "coordinate": origin.coordinate,
        },
        "destination": {
            "name": destination.name,
            "coordinate": destination.coordinate,
        },
        "primary": {
            "name": "Planned corridor",
            "geometry": primary,
            "distanceKm": primary_km,
            "etaDays": primary_days,
            "riskScore": 82,
            "riskLevel": "Critical",
        },
        "alternate": {
            "name": "Safest alternate",
            "geometry": alternate,
            "distanceKm": alternate_km,
            "etaDays": alternate_days,
            "riskScore": 21,
            "riskLevel": "Low",
            "additionalKm": max(0, alternate_km - primary_km),
            "etaDeltaDays": round(alternate_days - primary_days, 1),
            "confidence": 0.88,
            "reason": "Avoids all modelled critical and high-severity exposure zones with a wider safety buffer.",
        },
        "issues": issues,
        "recommendation": {
            "decision": "Take the safest alternate",
            "priority": "Act before dispatch",
            "summary": "Approve the green corridor and revalidate vessel, insurance, and terminal clearance before departure.",
            "steps": [
                "Notify the carrier and reserve capacity on the green corridor.",
                "Complete sanctions and counterparty screening.",
                "Confirm alternate terminal and fuel-window availability.",
            ],
        },
    }
