from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from backend.routes.predict import router as analysis_router


ROOT = Path(__file__).resolve().parent
FRONTEND = ROOT / "frontend"

app = FastAPI(
    title="LogiRisk AI",
    version="2.0.0",
    description="Logistics disruption visualization and resilient-route decision support.",
)

app.include_router(analysis_router, prefix="/api")
app.mount("/static", StaticFiles(directory=FRONTEND), name="static")


@app.get("/", include_in_schema=False)
async def dashboard() -> FileResponse:
    return FileResponse(FRONTEND / "index.html")


@app.get("/health", tags=["system"])
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "logirisk-ai"}
