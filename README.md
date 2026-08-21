# LogiRisk AI

An interactive logistics resilience command center that visualizes disruption
points on a route and recommends a lower-risk alternate corridor in green.

## Highlights

- Interactive, scroll-zoomable MapLibre map using the free OpenFreeMap style
- Animated shipment playback and incident briefings
- Animated conflict, missile, bombing, sanctions, weather, and port signals
- Clearly ranked green alternate route with distance, delay, and risk trade-offs
- FastAPI backend with deterministic scenario generation and no paid API key
- Responsive dashboard for desktop and mobile

## Run locally

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --reload
```

Open <http://127.0.0.1:8000>.

The map tiles require internet access. Route events are scenario intelligence
for decision-support demonstrations and are labelled as simulated—not verified
live incidents.
