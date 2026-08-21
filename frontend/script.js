const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const elements = {
  form: $("#routeForm"),
  origin: $("#originInput"),
  destination: $("#destinationInput"),
  analyze: $("#analyzeButton"),
  swap: $("#swapButton"),
  mapLoading: $("#mapLoading"),
  replay: $("#replayButton"),
  pause: $("#pauseButton"),
  focus: $("#focusButton"),
  mapActions: $(".map-actions"),
  playbackState: $("#playbackState"),
  briefCounter: $("#briefCounter"),
  briefSeverity: $("#briefSeverity"),
  briefTitle: $("#briefTitle"),
  briefDescription: $("#briefDescription"),
  briefProgress: $("#briefProgress"),
  eventAnimation: $("#eventAnimation"),
  eventSymbol: $("#eventSymbol"),
  confidence: $("#confidenceValue"),
  decisionTitle: $("#decisionTitle"),
  decisionSummary: $("#decisionSummary"),
  accept: $("#acceptRouteButton"),
  primaryRisk: $("#primaryRisk"),
  alternateRisk: $("#alternateRisk"),
  alternateDistance: $("#alternateDistance"),
  etaImpact: $("#etaImpact"),
  signalsAvoided: $("#signalsAvoided"),
  signalSubtitle: $("#signalSubtitle"),
  signalCount: $("#signalCount"),
  signalsList: $("#signalsList"),
  toast: $("#toast"),
  theme: $("#themeButton"),
};

const eventSymbols = {
  missile: "➤",
  conflict: "●",
  sanctions: "§",
  port: "⚓",
  weather: "ϟ",
};

let map;
let scenario;
let shipmentMarker;
let endpointMarkers = [];
let issueMarkers = [];
let activePopup;
let animationFrame;
let animationStartedAt = 0;
let pauseStartedAt = 0;
let pausedDuration = 0;
let isPaused = false;
let activeIssueIndex = -1;
let activeRoute = "primary";
let toastTimer;

function initialiseMap() {
  if (!window.maplibregl) {
    showToast("The map library could not load. Check your internet connection and refresh.");
    return;
  }

  map = new maplibregl.Map({
    container: "map",
    style: "https://tiles.openfreemap.org/styles/liberty",
    center: [63, 22],
    zoom: 3.3,
    minZoom: 1.5,
    maxZoom: 14,
    attributionControl: false,
    dragRotate: false,
  });

  map.scrollZoom.enable();
  map.touchZoomRotate.enable();
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
  map.addControl(
    new maplibregl.AttributionControl({ compact: true }),
    "bottom-right",
  );

  map.on("error", (event) => {
    if (event?.error?.message?.includes("style")) {
      showToast("Map tiles are unavailable right now, but route analysis is still active.");
    }
  });
}

function routeFeature(coordinates) {
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "LineString", coordinates },
  };
}

function addRouteLayers(data) {
  const layerIds = [
    "planned-route",
    "planned-casing",
    "safe-route",
    "safe-casing",
  ];
  const sourceIds = ["planned-source", "safe-source"];

  layerIds.forEach((id) => {
    if (map.getLayer(id)) map.removeLayer(id);
  });
  sourceIds.forEach((id) => {
    if (map.getSource(id)) map.removeSource(id);
  });

  map.addSource("planned-source", {
    type: "geojson",
    lineMetrics: true,
    data: routeFeature(data.primary.geometry),
  });
  map.addSource("safe-source", {
    type: "geojson",
    data: routeFeature(data.alternate.geometry),
  });

  map.addLayer({
    id: "safe-casing",
    type: "line",
    source: "safe-source",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": "rgba(255,255,255,0.92)",
      "line-width": ["interpolate", ["linear"], ["zoom"], 2, 7, 7, 11],
      "line-opacity": 0.92,
    },
  });
  map.addLayer({
    id: "safe-route",
    type: "line",
    source: "safe-source",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": "#18c986",
      "line-width": ["interpolate", ["linear"], ["zoom"], 2, 4, 7, 7],
      "line-dasharray": [2.2, 1.45],
      "line-opacity": 0.95,
    },
  });
  map.addLayer({
    id: "planned-casing",
    type: "line",
    source: "planned-source",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": "rgba(255,255,255,0.92)",
      "line-width": ["interpolate", ["linear"], ["zoom"], 2, 7, 7, 11],
      "line-opacity": 0.92,
    },
  });
  map.addLayer({
    id: "planned-route",
    type: "line",
    source: "planned-source",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-width": ["interpolate", ["linear"], ["zoom"], 2, 4, 7, 7],
      "line-gradient": [
        "interpolate",
        ["linear"],
        ["line-progress"],
        0,
        "#2f74f5",
        0.24,
        "#ffb047",
        0.38,
        "#ff4d63",
        0.82,
        "#ff4d63",
        1,
        "#2f74f5",
      ],
      "line-opacity": 0.96,
    },
  });
}

function clearMarkers() {
  endpointMarkers.forEach((marker) => marker.remove());
  issueMarkers.forEach(({ marker }) => marker.remove());
  endpointMarkers = [];
  issueMarkers = [];
  shipmentMarker?.remove();
  shipmentMarker = null;
  activePopup?.remove();
}

function createEndpointMarker(kind, coordinate, label) {
  const element = document.createElement("button");
  element.type = "button";
  element.className = `endpoint-marker ${kind}`;
  element.title = label;
  element.setAttribute("aria-label", label);
  const marker = new maplibregl.Marker({ element, anchor: "center" })
    .setLngLat(coordinate)
    .setPopup(
      new maplibregl.Popup({ offset: 14 }).setText(label),
    )
    .addTo(map);
  endpointMarkers.push(marker);
}

function popupForIssue(issue) {
  const copy = document.createElement("div");
  copy.className = "popup-copy";
  const severity = document.createElement("small");
  severity.textContent = `${issue.severity} • ${issue.status}`;
  const title = document.createElement("strong");
  title.textContent = issue.title;
  const description = document.createElement("p");
  description.textContent = issue.action;
  copy.append(severity, title, description);
  return copy;
}

function createIssueMarkers(issues) {
  issues.forEach((issue, index) => {
    const element = document.createElement("button");
    element.type = "button";
    element.className = "issue-map-marker";
    element.dataset.type = issue.type;
    element.title = issue.title;
    element.setAttribute("aria-label", issue.title);
    const symbol = document.createElement("span");
    symbol.textContent = eventSymbols[issue.type] || "!";
    element.append(symbol);
    element.addEventListener("click", () => focusIssue(index, true));

    const marker = new maplibregl.Marker({ element, anchor: "center" })
      .setLngLat(issue.coordinate)
      .addTo(map);
    issueMarkers.push({ marker, element });
  });
}

function createShipmentMarker() {
  const element = document.createElement("div");
  element.className = "route-marker";
  element.setAttribute("aria-label", "Animated shipment position");
  shipmentMarker = new maplibregl.Marker({ element, anchor: "center" })
    .setLngLat(scenario.primary.geometry[0])
    .addTo(map);
}

function fitScenario() {
  if (!map || !scenario) return;
  const coordinates = [...scenario.primary.geometry, ...scenario.alternate.geometry];
  const bounds = coordinates.reduce(
    (current, coordinate) => current.extend(coordinate),
    new maplibregl.LngLatBounds(coordinates[0], coordinates[0]),
  );
  map.fitBounds(bounds, {
    padding: { top: 90, right: 75, bottom: 185, left: 75 },
    duration: 950,
    maxZoom: 6.4,
  });
}

function renderScenario(data) {
  scenario = data;
  if (!map) return;

  const draw = () => {
    cancelAnimationFrame(animationFrame);
    clearMarkers();
    addRouteLayers(data);
    createEndpointMarker("origin", data.origin.coordinate, data.origin.name);
    createEndpointMarker("destination", data.destination.coordinate, data.destination.name);
    createIssueMarkers(data.issues);
    createShipmentMarker();
    renderDecision(data);
    renderSignals(data.issues);
    activeRoute = "primary";
    elements.accept.innerHTML = `${checkIcon()} Preview green route`;
    shipmentMarker.getElement().classList.remove("safe-active");
    fitScenario();
    replayAnimation();
  };

  if (map.loaded()) draw();
  else map.once("load", draw);
}

function renderDecision(data) {
  elements.confidence.textContent = `${Math.round(data.alternate.confidence * 100)}% confidence`;
  elements.decisionTitle.textContent = data.recommendation.decision;
  elements.decisionSummary.textContent = data.alternate.reason;
  elements.primaryRisk.textContent = data.primary.riskScore;
  elements.alternateRisk.textContent = data.alternate.riskScore;
  elements.primaryRisk.parentElement.querySelector(".risk-bar i").style.setProperty(
    "--score",
    `${data.primary.riskScore}%`,
  );
  elements.alternateRisk.parentElement.querySelector(".risk-bar i").style.setProperty(
    "--score",
    `${data.alternate.riskScore}%`,
  );
  elements.alternateDistance.textContent = `${formatNumber(data.alternate.distanceKm)} km`;
  const etaDelta = data.alternate.etaDeltaDays;
  elements.etaImpact.textContent = etaDelta > 0 ? `+${etaDelta} days` : `${Math.abs(etaDelta)} days faster`;
  elements.signalsAvoided.textContent = `${data.issues.length} / ${data.issues.length}`;
  elements.signalCount.textContent = data.issues.length;
  elements.signalSubtitle.textContent = `${data.issues.length} scenario issues mapped`;
}

function renderSignals(issues) {
  elements.signalsList.replaceChildren();
  issues.forEach((issue, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "signal-item";
    button.dataset.index = index;

    const icon = document.createElement("span");
    icon.className = "signal-icon";
    icon.textContent = eventSymbols[issue.type] || "!";

    const copy = document.createElement("span");
    copy.className = "signal-copy";
    const title = document.createElement("strong");
    title.textContent = issue.title;
    const status = document.createElement("small");
    status.textContent = `${issue.type} • ${Math.round(issue.routeProgress * 100)}% into route`;
    copy.append(title, status);

    const severity = document.createElement("small");
    severity.textContent = issue.severity;
    button.append(icon, copy, severity);
    button.addEventListener("click", () => focusIssue(index, true));
    elements.signalsList.append(button);
  });
}

function focusIssue(index, moveMap = false) {
  if (!scenario || !scenario.issues[index]) return;
  const issue = scenario.issues[index];
  activeIssueIndex = index;
  elements.briefCounter.textContent = `Signal ${index + 1} of ${scenario.issues.length}`;
  elements.briefSeverity.textContent = `${issue.severity} scenario signal`;
  elements.briefTitle.textContent = issue.title;
  elements.briefDescription.textContent = issue.description;
  elements.eventAnimation.dataset.type = issue.type;
  elements.eventSymbol.textContent = eventSymbols[issue.type] || "!";
  elements.briefProgress.style.width = `${Math.max(4, issue.routeProgress * 100)}%`;

  issueMarkers.forEach(({ element }, markerIndex) => {
    element.classList.toggle("active", markerIndex === index);
  });
  $$(".signal-item").forEach((item, itemIndex) => {
    item.classList.toggle("active", itemIndex === index);
  });

  if (moveMap) {
    map.flyTo({ center: issue.coordinate, zoom: Math.max(map.getZoom(), 5), duration: 800 });
    activePopup?.remove();
    activePopup = new maplibregl.Popup({ offset: 25, closeButton: false })
      .setLngLat(issue.coordinate)
      .setDOMContent(popupForIssue(issue))
      .addTo(map);
  }
}

function coordinateAtProgress(coordinates, progress) {
  const scaled = Math.min(0.99999, Math.max(0, progress)) * (coordinates.length - 1);
  const index = Math.floor(scaled);
  const local = scaled - index;
  const current = coordinates[index];
  const next = coordinates[Math.min(index + 1, coordinates.length - 1)];
  return [
    current[0] + (next[0] - current[0]) * local,
    current[1] + (next[1] - current[1]) * local,
  ];
}

function animationStep(timestamp) {
  if (!scenario || !shipmentMarker) return;
  if (!animationStartedAt) animationStartedAt = timestamp;

  if (isPaused) {
    animationFrame = requestAnimationFrame(animationStep);
    return;
  }

  const duration = activeRoute === "primary" ? 20000 : 15000;
  const elapsed = timestamp - animationStartedAt - pausedDuration;
  const progress = (elapsed % duration) / duration;
  const coordinates = scenario[activeRoute].geometry;
  shipmentMarker.setLngLat(coordinateAtProgress(coordinates, progress));
  elements.briefProgress.style.width = `${Math.max(3, progress * 100)}%`;

  if (activeRoute === "primary") {
    let nextIssue = scenario.issues.findIndex(
      (issue) => progress <= issue.routeProgress + 0.075,
    );
    if (nextIssue < 0) nextIssue = scenario.issues.length - 1;
    if (nextIssue !== activeIssueIndex) focusIssue(nextIssue, false);
  }

  animationFrame = requestAnimationFrame(animationStep);
}

function replayAnimation() {
  cancelAnimationFrame(animationFrame);
  animationStartedAt = 0;
  pausedDuration = 0;
  pauseStartedAt = 0;
  isPaused = false;
  activeIssueIndex = -1;
  elements.mapActions.classList.remove("paused");
  elements.playbackState.textContent = activeRoute === "primary" ? "Playback active" : "Safe route preview";
  if (activeRoute === "primary" && scenario?.issues.length) focusIssue(0, false);
  animationFrame = requestAnimationFrame(animationStep);
}

function togglePause() {
  if (!scenario) return;
  isPaused = !isPaused;
  elements.mapActions.classList.toggle("paused", isPaused);
  elements.playbackState.textContent = isPaused
    ? "Playback paused"
    : activeRoute === "primary"
      ? "Playback active"
      : "Safe route preview";

  if (isPaused) {
    pauseStartedAt = performance.now();
  } else if (pauseStartedAt) {
    pausedDuration += performance.now() - pauseStartedAt;
    pauseStartedAt = 0;
  }
}

function previewSafeRoute() {
  if (!scenario || !shipmentMarker) return;
  activeRoute = activeRoute === "primary" ? "alternate" : "primary";
  const safe = activeRoute === "alternate";
  shipmentMarker.getElement().classList.toggle("safe-active", safe);
  elements.accept.innerHTML = safe
    ? `${routeIcon()} Return to risk playback`
    : `${checkIcon()} Preview green route`;
  if (map.getLayer("planned-route")) {
    map.setPaintProperty("planned-route", "line-opacity", safe ? 0.36 : 0.96);
    map.setPaintProperty("planned-casing", "line-opacity", safe ? 0.32 : 0.92);
    map.setPaintProperty("safe-route", "line-opacity", safe ? 1 : 0.95);
    map.setPaintProperty("safe-route", "line-width", safe ? 7 : 4);
  }
  if (safe) {
    elements.briefCounter.textContent = "Safest alternate selected";
    elements.briefSeverity.textContent = "Low-risk corridor";
    elements.briefTitle.textContent = scenario.alternate.name;
    elements.briefDescription.textContent = scenario.alternate.reason;
    elements.eventAnimation.dataset.type = "safe";
    elements.eventSymbol.textContent = "✓";
    issueMarkers.forEach(({ element }) => element.classList.remove("active"));
  }
  fitScenario();
  replayAnimation();
}

async function analyzeRoute() {
  const origin = elements.origin.value.trim();
  const destination = elements.destination.value.trim();
  if (!origin || !destination) {
    showToast("Enter both an origin and destination.");
    return;
  }

  setLoading(true);
  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ origin, destination }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "Route analysis failed.");
    renderScenario(data);
    $("#workspace").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    showToast(error.message || "Unable to analyze this corridor.");
  } finally {
    setLoading(false);
  }
}

function setLoading(loading) {
  elements.analyze.classList.toggle("loading", loading);
  elements.analyze.disabled = loading;
  elements.mapLoading.classList.toggle("visible", loading);
}

function showToast(message) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");
  toastTimer = setTimeout(() => elements.toast.classList.remove("visible"), 4600);
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-IN").format(value);
}

function checkIcon() {
  return '<svg viewBox="0 0 24 24"><path d="M5 12.5 9.2 17 19 7"/></svg>';
}

function routeIcon() {
  return '<svg viewBox="0 0 24 24"><path d="M5 12h14M10 7l-5 5 5 5"/></svg>';
}

elements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  analyzeRoute();
});

elements.swap.addEventListener("click", () => {
  const origin = elements.origin.value;
  elements.origin.value = elements.destination.value;
  elements.destination.value = origin;
});

$$('[data-origin][data-destination]').forEach((button) => {
  button.addEventListener("click", () => {
    elements.origin.value = button.dataset.origin;
    elements.destination.value = button.dataset.destination;
    analyzeRoute();
  });
});

elements.replay.addEventListener("click", replayAnimation);
elements.pause.addEventListener("click", togglePause);
elements.focus.addEventListener("click", fitScenario);
elements.accept.addEventListener("click", previewSafeRoute);
elements.theme.addEventListener("click", () => document.body.classList.toggle("dim-map"));

document.addEventListener("visibilitychange", () => {
  if (document.hidden && !isPaused) togglePause();
});

initialiseMap();
analyzeRoute();
