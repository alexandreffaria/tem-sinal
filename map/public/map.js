// The public map: fetches the published tiles in view and colours each cell by the chosen
// carrier's label. maplibregl and h3 are the globals of the scripts index.html loads.
import { label } from "./label.js";

const BUCKET = "cellsignalmapper-a9da1.firebasestorage.app";
/** Served by `node serve.js` with the fixtures when the page runs on this machine. */
const STORAGE = ["localhost", "127.0.0.1"].includes(location.hostname)
  ? location.origin
  : "https://firebasestorage.googleapis.com";

/** The H3 resolution of a published tile file: TILE_RESOLUTION in functions/src/aggregate.ts. */
const TILE_RESOLUTION = 5;
/** Below this zoom the view spans too many tiles to fetch, and the cells are too small to see. */
const MIN_ZOOM = 9;

/** Carrier names by PLMN (MCC 724, Brazil); any other code is shown as is. */
const CARRIERS = {
  "72402": "TIM", "72403": "TIM", "72404": "TIM",
  "72405": "Claro",
  "72406": "Vivo", "72410": "Vivo", "72411": "Vivo", "72423": "Vivo",
  "72416": "Oi", "72424": "Oi", "72431": "Oi",
  "72432": "Algar", "72433": "Algar", "72434": "Algar",
};
const carrierName = (plmn) => (CARRIERS[plmn] ? `${CARRIERS[plmn]} (${plmn})` : plmn);

const LABELS = {
  signal: "Sinal · Signal",
  emergency: "Só chamadas de emergência · Emergency calls only",
  none: "Sem sinal · No signal",
};

const css = getComputedStyle(document.documentElement);
const colour = (name) => css.getPropertyValue(`--${name}`).trim();

const select = document.getElementById("carrier");
const status = document.getElementById("status");

/** Each requested tile's cells; a tile with no published cells (404) is an empty array. */
const tiles = new Map();
/** Every fetched cell by H3 index. */
const cells = new Map();
/** The tiles being fetched; a failed fetch leaves its tile out of both, so a later move retries it. */
const fetching = new Set();

async function fetchTile(tile) {
  const name = encodeURIComponent(`tiles/${tile}.json`);
  const response = await fetch(`${STORAGE}/v0/b/${BUCKET}/o/${name}?alt=media`);
  if (response.status === 404) return [];
  if (!response.ok) throw new Error(`tile ${tile}: HTTP ${response.status}`);
  return response.json();
}

/** The tiles that cover the view: those whose centres are in it, and their neighbours. */
function tilesInView(map) {
  const b = map.getBounds();
  const ring = [
    [b.getWest(), b.getSouth()], [b.getEast(), b.getSouth()], [b.getEast(), b.getNorth()],
    [b.getWest(), b.getNorth()], [b.getWest(), b.getSouth()],
  ];
  const centre = map.getCenter();
  const inside = h3.polygonToCells([ring], TILE_RESOLUTION, true);
  inside.push(h3.latLngToCell(centre.lat, centre.lng, TILE_RESOLUTION));
  return [...new Set(inside.flatMap((tile) => h3.gridDisk(tile, 1)))];
}

function setStatus(text) {
  status.textContent = text;
}

function updateCarriers() {
  const seen = new Set();
  for (const cell of cells.values()) for (const plmn of Object.keys(cell.carriers)) seen.add(plmn);
  if (seen.size === 0) return;
  const current = select.disabled ? null : select.value;
  const plmns = [...seen].sort((a, b) => carrierName(a).localeCompare(carrierName(b)));
  select.replaceChildren(...plmns.map((plmn) => new Option(carrierName(plmn), plmn)));
  select.value = plmns.includes(current) ? current : plmns[0];
  select.disabled = false;
}

function features(plmn) {
  const out = [];
  for (const cell of cells.values()) {
    const counts = cell.carriers[plmn];
    if (!counts) continue;
    out.push({
      type: "Feature",
      properties: { h3: cell.h3, label: label(counts) },
      geometry: { type: "Polygon", coordinates: [h3.cellToBoundary(cell.h3, true)] },
    });
  }
  return { type: "FeatureCollection", features: out };
}

function render(map) {
  map.getSource("cells").setData(features(select.value));
}

/** Says why nothing shows, when nothing does. */
function explain(map, view) {
  if (map.getZoom() < MIN_ZOOM) return setStatus("Aproxime o mapa para ver o sinal. · Zoom in to see the signal.");
  const here = view.flatMap((tile) => tiles.get(tile) ?? []);
  if (here.length === 0) return setStatus("Ainda não há medições aqui. · No readings here yet.");
  if (!here.some((cell) => cell.carriers[select.value])) {
    return setStatus("Nenhuma medição desta operadora aqui. · No readings for this carrier here.");
  }
  setStatus("");
}

async function load(map) {
  if (map.getZoom() < MIN_ZOOM) return explain(map, []);
  const view = tilesInView(map);
  const missing = view.filter((tile) => !tiles.has(tile) && !fetching.has(tile));
  if (missing.length > 0) setStatus("Carregando… · Loading…");
  const results = await Promise.allSettled(missing.map(async (tile) => {
    fetching.add(tile);
    try {
      const published = await fetchTile(tile);
      tiles.set(tile, published);
      for (const cell of published) cells.set(cell.h3, cell);
    } finally {
      fetching.delete(tile);
    }
  }));
  if (results.some((r) => r.status === "rejected")) {
    setStatus("Não foi possível carregar os dados. Tente de novo mais tarde. · Couldn't load the data. Try again later.");
    return;
  }
  updateCarriers();
  render(map);
  explain(map, view);
}

/** A table of the cell's readings: one row per carrier, with its label's colour and the three counts. */
function popup(cell) {
  const el = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const table = el("table");
  const head = table.createTHead().insertRow();
  for (const [pt, en] of [["Operadora", "Carrier"], ["Serviço", "Service"], ["Emergência", "Emergency"], ["Sem serviço", "No service"]]) {
    const th = el("th", pt);
    th.append(el("br"), el("span", en, "en"));
    head.append(th);
  }
  const body = table.createTBody();
  for (const plmn of Object.keys(cell.carriers).sort((a, b) => carrierName(a).localeCompare(carrierName(b)))) {
    const counts = cell.carriers[plmn];
    const which = label(counts);
    const row = body.insertRow();
    const name = el("th");
    const swatch = el("span", undefined, "swatch");
    swatch.style.background = colour(which);
    name.append(swatch, ` ${carrierName(plmn)}`, el("br"), el("span", LABELS[which], "en"));
    row.append(name);
    for (const n of [counts.serviceN, counts.emergencyN, counts.noServiceN]) row.append(el("td", String(n)));
  }
  const root = el("div");
  root.append(table, el("p", `Última medição · Last seen: ${cell.lastSeen}`));
  return root;
}

const map = new maplibregl.Map({
  container: "map",
  // OpenFreeMap: free, no key, no limit on map views, commercial use allowed, attribution kept.
  style: "https://tiles.openfreemap.org/styles/liberty",
  center: [-51.9, -14.2],
  zoom: 3.5,
  hash: true,
});
map.addControl(new maplibregl.NavigationControl(), "top-right");
map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true } }), "top-right");

map.on("load", () => {
  map.addSource("cells", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  const byLabel = ["match", ["get", "label"],
    "signal", colour("signal"), "emergency", colour("emergency"), colour("none")];
  map.addLayer({ id: "cells-fill", type: "fill", source: "cells", paint: { "fill-color": byLabel, "fill-opacity": 0.55 } });
  // A line keeps cells visible as dots at zooms where a 50 m hexagon is under a pixel.
  map.addLayer({
    id: "cells-line", type: "line", source: "cells",
    paint: { "line-color": byLabel, "line-width": ["interpolate", ["linear"], ["zoom"], 9, 3, 15, 1] },
  });
  map.on("click", (e) => {
    const [hit] = map.queryRenderedFeatures(e.point, { layers: ["cells-fill", "cells-line"] });
    if (!hit) return;
    const cell = cells.get(hit.properties.h3);
    new maplibregl.Popup({ maxWidth: "340px" }).setLngLat(e.lngLat).setDOMContent(popup(cell)).addTo(map);
  });
  for (const layer of ["cells-fill", "cells-line"]) {
    map.on("mouseenter", layer, () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", layer, () => { map.getCanvas().style.cursor = ""; });
  }
  map.on("moveend", () => load(map));
  select.addEventListener("change", () => {
    render(map);
    explain(map, map.getZoom() < MIN_ZOOM ? [] : tilesInView(map));
  });
  load(map);
});
