// Made-up public cells for the store screenshots of the map: trails invented through the Serra do
// Mar forest west of Rio de Janeiro, where no one lives, with invented counts for three carriers.
// Seeded, so every run writes the same files. The files have the shape the aggregate function
// publishes: tiles/<res-5 cell>.json and overview/<resolution>.json.
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { label } from "../map/public/label.js";
import { TILE_RESOLUTION } from "../map/public/tiles.js";

const h3 = createRequire(import.meta.url)("../map/node_modules/h3-js");

/** The resolution of a public cell, a hexagon about 50 m across. */
const CELL_RESOLUTION = 11;
const OVERVIEW_RESOLUTIONS = [3, 4, 5, 6];
const CARRIERS = ["72402", "72405", "72406"]; // TIM, Claro, Vivo

/**
 * Each trail: where it starts, its first heading in degrees, and per carrier how good the signal is
 * at its start and at its end (1 is signal, 0.5 emergency calls only, 0 none). Every start is in
 * forest with no road or building within a kilometre.
 */
export const TRAILS = [
  { start: [-22.9, -44.1], heading: 60, quality: { "72402": [0.9, 0.2], "72405": [0.8, 0.45], "72406": [1.1, 0.6] } },
  { start: [-22.915, -44.18], heading: 200, quality: { "72402": [0.7, 0.1], "72405": [0.3, 0.0], "72406": [0.9, 0.5] } },
  { start: [-22.96, -44.24], heading: 120, quality: { "72402": [0.6, 0.6], "72405": [0.55, 0.4], "72406": [1.0, 0.9] } },
  { start: [-22.985, -44.143], heading: 0, quality: { "72402": [0.2, 0.0], "72405": [0.1, 0.0], "72406": [0.6, 0.3] } },
];

/** The trail's own place, for the zoomed-in screenshots: about the middle of the first trail. */
export const ZOOMED_IN = TRAILS[0];

/** A seeded random number generator (mulberry32), so the fixtures never change between runs. */
function random(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The points of a 4 km trail that winds from [start], one every 20 m. */
function walk([lat, lon], heading, next) {
  const points = [];
  let direction = (heading * Math.PI) / 180;
  let turn = 0;
  for (let i = 0; i < 200; i++) {
    points.push([lat, lon]);
    turn = turn * 0.9 + (next() - 0.5) * 0.08;
    direction += turn;
    lat += (20 / 111_320) * Math.cos(direction);
    lon += (20 / (111_320 * Math.cos((lat * Math.PI) / 180))) * Math.sin(direction);
  }
  return points;
}

/** Counts of readings that make a cell with signal [quality] (see TRAILS) look as it should. */
function counts(quality, next) {
  const n = 8 + Math.floor(next() * 40);
  const q = Math.max(0, Math.min(1, quality + (next() - 0.5) * 0.3));
  const service = q > 0.7 ? n : q > 0.35 ? Math.round(n * (q - 0.2)) : 0;
  const emergency = q > 0.7 ? 0 : q > 0.35 ? n - service : Math.round(n * q * 1.5);
  const noService = n - service - emergency;
  const best = service > 0 ? -80 - Math.round((1 - q) * 35) : null;
  return {
    best, median: best === null ? null : best - 8, tech: best === null ? null : q > 0.9 ? "NR" : "LTE",
    serviceN: service, emergencyN: emergency, noServiceN: noService,
  };
}

/** The public cells along every trail. */
export function cells() {
  const next = random(20261116);
  const out = new Map();
  TRAILS.forEach(({ start, heading, quality }) => {
    const points = walk(start, heading, next);
    points.forEach(([lat, lon], i) => {
      const cell = h3.latLngToCell(lat, lon, CELL_RESOLUTION);
      if (out.has(cell)) return;
      const along = i / (points.length - 1);
      const carriers = {};
      for (const plmn of CARRIERS) {
        const [from, to] = quality[plmn];
        carriers[plmn] = counts(from + (to - from) * along + Math.sin(along * 9 + plmn.length) * 0.15, next);
      }
      out.set(cell, { h3: cell, carriers, lastSeen: next() < 0.7 ? "2026-10" : "2026-09" });
    });
  });
  return [...out.values()];
}

/** Writes the tiles and the overview of [cells()] into [dir], as the page fetches them. */
export async function writeFixtures(dir) {
  const all = cells();
  await mkdir(join(dir, "tiles"), { recursive: true });
  await mkdir(join(dir, "overview"), { recursive: true });
  const byTile = Map.groupBy(all, (cell) => h3.cellToParent(cell.h3, TILE_RESOLUTION));
  for (const [tile, inTile] of byTile) await writeFile(join(dir, "tiles", `${tile}.json`), JSON.stringify(inTile));
  for (const resolution of OVERVIEW_RESOLUTIONS) {
    const overview = [...Map.groupBy(all, (cell) => h3.cellToParent(cell.h3, resolution))].map(([h3Cell, inside]) => {
      const carriers = {};
      for (const cell of inside) {
        for (const [plmn, cellCounts] of Object.entries(cell.carriers)) {
          const byLabel = (carriers[plmn] ??= [0, 0, 0]);
          byLabel[["signal", "emergency", "none"].indexOf(label(cellCounts))]++;
        }
      }
      return { h3: h3Cell, carriers, lastSeen: inside.map((cell) => cell.lastSeen).sort().at(-1) };
    });
    await writeFile(join(dir, "overview", `${resolution}.json`), JSON.stringify(overview));
  }
}
