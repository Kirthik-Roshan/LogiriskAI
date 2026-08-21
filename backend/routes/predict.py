from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.services.routing import build_scenario, resolve_place


router = APIRouter(tags=["route intelligence"])


class AnalysisRequest(BaseModel):
    origin: str = Field(min_length=2, max_length=160)
    destination: str = Field(min_length=2, max_length=160)


@router.post("/analyze")
async def analyze_route(payload: AnalysisRequest) -> dict:
    try:
        origin = resolve_place(payload.origin)
        destination = resolve_place(payload.destination)
        return build_scenario(origin, destination)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/examples")
async def route_examples() -> list[dict[str, str]]:
    return [
        {"label": "Gulf → India", "origin": "Ras Tanura", "destination": "Mumbai"},
        {"label": "UAE → Singapore", "origin": "Fujairah", "destination": "Singapore"},
        {"label": "Europe → India", "origin": "Rotterdam", "destination": "Mundra"},
    ]
