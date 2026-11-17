// The public map: from TILE_ZOOM on, fetches the published tiles in view and colours each cell by
// the chosen carrier's label, cells with signal by how strong it is; below it, shows the overview
// at the resolution that fits the zoom.
// maplibregl and h3 are the globals of the scripts index.html loads.
import { coarseShade, label, level, shade } from "./label.js";
import { TILE_ZOOM, overviewResolution, tilesInView } from "./tiles.js";
import { tileLoader } from "./loader.js";

const BUCKET = "cellsignalmapper-a9da1.firebasestorage.app";
/** Served by `node serve.js` with the fixtures when the page runs on this machine. */
const STORAGE = ["localhost", "127.0.0.1"].includes(location.hostname)
  ? location.origin
  : "https://firebasestorage.googleapis.com";

/** Carrier names by PLMN (MCC 724, Brazil); any other code is shown as is. */
const CARRIERS = {
  "72402": "TIM", "72403": "TIM", "72404": "TIM",
  "72405": "Claro",
  "72406": "Vivo", "72410": "Vivo", "72411": "Vivo", "72423": "Vivo",
  "72416": "Oi", "72424": "Oi", "72431": "Oi",
  "72432": "Algar", "72433": "Algar", "72434": "Algar",
};
const carrierName = (plmn) => (CARRIERS[plmn] ? `${CARRIERS[plmn]} (${plmn})` : plmn);

/** The words for a level, 0 to 4, in Portuguese and English. */
const LEVEL_WORDS = [["muito fraco", "very weak"], ["fraco", "weak"], ["médio", "moderate"], ["bom", "good"], ["ótimo", "great"]];

/** What each shade means, in Portuguese and English. */
const SHADES = {
  ...Object.fromEntries(LEVEL_WORDS.map(([pt, en], i) => [`signal-${i}`, `Sinal ${pt} · ${en[0].toUpperCase()}${en.slice(1)} signal`])),
  "signal-unknown": "Sinal, força desconhecida · Signal, strength unknown",
  emergency: "Só chamadas de emergência · Emergency calls only",
  none: "Sem sinal · No signal",
};

/** The generation a network type is known by. */
const GENERATIONS = { NR: "5G", LTE: "4G", WCDMA: "3G", GSM: "2G" };

/** A strength in dBm with a minus sign. */
const dbm = (n) => `${String(n).replace("-", "\u2212")} dBm`;

/**
 * What a public cell with signal says of its strength, in two lines, as "4G, sinal bom · good
 * signal" and "−92 dBm (melhor · best −85 dBm)"; null when it has no level.
 */
function strength(figures) {
  const signalLevel = level(figures);
  if (signalLevel === null) return null;
  const [pt, en] = LEVEL_WORDS[signalLevel];
  const tech = GENERATIONS[figures.tech] ?? figures.tech;
  return [`${tech}, sinal ${pt} · ${en} signal`, `${dbm(figures.median)} (melhor · best ${dbm(figures.best)})`];
}

const css = getComputedStyle(document.documentElement);
const colour = (name) => css.getPropertyValue(`--${name}`).trim();

const select = document.getElementById("carrier");
const zoomedOut = document.getElementById("zoomed-out");
const status = document.getElementById("status");

/** The published file at [path]; one not published (404) is an empty array. */
async function fetchPublic(path) {
  const response = await fetch(`${STORAGE}/v0/b/${BUCKET}/o/${encodeURIComponent(path)}?alt=media`);
  if (response.status === 404) return [];
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

const { tiles, cells, fetching, load: loadTiles } = tileLoader((tile) => fetchPublic(`tiles/${tile}.json`));
/** The overview, by resolution as its "tiles". */
const overview = tileLoader((resolution) => fetchPublic(`overview/${resolution}.json`));

/** The tiles that cover the map's current view. */
function viewTiles(map) {
  const b = map.getBounds();
  return tilesInView(h3, {
    west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth(),
  });
}

/** The overview resolution the map shows now, or null when it shows the tiles. */
const coarse = (map) => overviewResolution(map.getZoom());

/** The cells the map shows now: the overview's at its resolution, or every fetched tile's. */
function shown(map) {
  const resolution = coarse(map);
  return resolution === null ? [...cells.values()] : overview.tiles.get(resolution) ?? [];
}

function setStatus(text) {
  status.textContent = text;
}

function updateCarriers() {
  const seen = new Set();
  for (const cell of [...cells.values(), ...overview.cells.values()]) for (const plmn of Object.keys(cell.carriers)) seen.add(plmn);
  if (seen.size === 0) return;
  const current = select.disabled ? null : select.value;
  const plmns = [...seen].sort((a, b) => carrierName(a).localeCompare(carrierName(b)));
  select.replaceChildren(...plmns.map((plmn) => new Option(carrierName(plmn), plmn)));
  select.value = plmns.includes(current) ? current : plmns[0];
  select.disabled = false;
}

function features(map, plmn) {
  const shadeOf = coarse(map) === null ? shade : coarseShade;
  const out = [];
  for (const cell of shown(map)) {
    const counts = cell.carriers[plmn];
    if (!counts) continue;
    out.push({
      type: "Feature",
      properties: { h3: cell.h3, shade: shadeOf(counts) },
      geometry: { type: "Polygon", coordinates: [h3.cellToBoundary(cell.h3, true)] },
    });
  }
  return { type: "FeatureCollection", features: out };
}

function render(map) {
  map.getSource("cells").setData(features(map, select.value));
  zoomedOut.hidden = coarse(map) === null;
}

/** Says why nothing shows, when nothing does. */
function explain(map, view) {
  const resolution = coarse(map);
  if (resolution !== null) {
    if (overview.fetching.has(resolution)) return setStatus("Carregando… · Loading…");
    const all = overview.tiles.get(resolution) ?? [];
    if (all.length === 0) return setStatus("Ainda não há medições. · No readings yet.");
    if (!all.some((cell) => cell.carriers[select.value])) {
      return setStatus("Nenhuma medição desta operadora ainda. · No readings for this carrier yet.");
    }
    return setStatus("");
  }
  if (view.some((tile) => fetching.has(tile))) return setStatus("Carregando… · Loading…");
  const here = view.flatMap((tile) => tiles.get(tile) ?? []);
  if (here.length === 0) return setStatus("Ainda não há medições aqui. · No readings here yet.");
  if (!here.some((cell) => cell.carriers[select.value])) {
    return setStatus("Nenhuma medição desta operadora aqui. · No readings for this carrier here.");
  }
  setStatus("");
}

/** The tiles of the view when the map shows tiles; none when it shows the overview. */
const tilesShown = (map) => (coarse(map) === null ? viewTiles(map) : []);

/**
 * Loads what the view shows, the overview at its resolution or the view's tiles, and draws it;
 * only the latest load sets the status.
 */
async function load(map) {
  const resolution = coarse(map);
  const view = tilesShown(map);
  const loaded = Promise.all([loadTiles(view), overview.load(resolution === null ? [] : [resolution])]);
  if (view.some((tile) => fetching.has(tile)) || overview.fetching.has(resolution)) setStatus("Carregando… · Loading…");
  // Each load asks both loaders, so either one's latest load is this page's latest.
  const outcomes = await loaded;
  const latest = outcomes.every((outcome) => outcome.latest);
  const failed = outcomes.some((outcome) => outcome.failed);
  updateCarriers();
  render(map);
  if (!latest) return;
  if (failed) {
    setStatus("Não foi possível carregar os dados. Tente de novo mais tarde. · Couldn't load the data. Try again later.");
    return;
  }
  explain(map, view);
}

/**
 * A table of the cell's figures, one row per carrier with its shade's colour and meaning: a public
 * cell's three counts of readings and, with signal, its strength; or an overview cell's counts of
 * the public cells inside it by label.
 */
function popup(cell) {
  const isCoarse = overview.cells.has(cell.h3);
  const el = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const table = el("table");
  const head = table.createTHead().insertRow();
  const headings = isCoarse
    ? [["Operadora", "Carrier"], ["Sinal", "Signal"], ["Emergência", "Emergency"], ["Sem sinal", "No signal"]]
    : [["Operadora", "Carrier"], ["Serviço", "Service"], ["Emergência", "Emergency"], ["Sem serviço", "No service"]];
  for (const [pt, en] of headings) {
    const th = el("th", pt);
    th.append(el("br"), el("span", en, "en"));
    head.append(th);
  }
  const body = table.createTBody();
  for (const plmn of Object.keys(cell.carriers).sort((a, b) => carrierName(a).localeCompare(carrierName(b)))) {
    const counts = cell.carriers[plmn];
    const which = isCoarse ? coarseShade(counts) : shade(counts);
    const row = body.insertRow();
    const name = el("th");
    const swatch = el("span", undefined, "swatch");
    swatch.style.background = colour(which);
    const words = (!isCoarse && label(counts) === "signal" && strength(counts)) || [SHADES[which]];
    name.append(swatch, ` ${carrierName(plmn)}`, ...words.flatMap((line) => [el("br"), el("span", line, "en")]));
    row.append(name);
    const numbers = isCoarse ? counts.slice(0, 3) : [counts.serviceN, counts.emergencyN, counts.noServiceN];
    for (const n of numbers) row.append(el("td", String(n)));
  }
  const root = el("div");
  if (isCoarse) root.append(el("p", "Pontos medidos nesta área · Measured spots in this area"));
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
  const byShade = ["match", ["get", "shade"],
    ...Object.keys(SHADES).filter((name) => name !== "none").flatMap((name) => [name, colour(name)]), colour("none")];
  map.addLayer({ id: "cells-fill", type: "fill", source: "cells", paint: { "fill-color": byShade, "fill-opacity": 0.7 } });
  // A line keeps cells visible as dots at zooms where a 50 m hexagon is under a pixel.
  map.addLayer({
    id: "cells-line", type: "line", source: "cells",
    paint: { "line-color": byShade, "line-width": ["interpolate", ["linear"], ["zoom"], 9, 3, 15, 1] },
  });
  map.on("click", (e) => {
    const [hit] = map.queryRenderedFeatures(e.point, { layers: ["cells-fill", "cells-line"] });
    if (!hit) return;
    const cell = cells.get(hit.properties.h3) ?? overview.cells.get(hit.properties.h3);
    new maplibregl.Popup({ maxWidth: "340px" }).setLngLat(e.lngLat).setDOMContent(popup(cell)).addTo(map);
  });
  for (const layer of ["cells-fill", "cells-line"]) {
    map.on("mouseenter", layer, () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", layer, () => { map.getCanvas().style.cursor = ""; });
  }
  map.on("moveend", () => load(map));
  select.addEventListener("change", () => {
    render(map);
    explain(map, tilesShown(map));
  });
  load(map);
});
