import assert from "node:assert/strict";
import { test } from "node:test";
import * as h3 from "h3-js";
import { TILE_RESOLUTION, tilesInView } from "./public/tiles.js";

// Made-up views across Brazil's latitudes, about the size of a 1920x1080 view at MIN_ZOOM, and
// one much smaller than a tile.
const views = {
  north: { west: -60.4, south: 2.1, east: -59.1, north: 2.8 },
  equator: { west: -48.3, south: -0.5, east: -47.0, north: 0.2 },
  centre: { west: -47.9, south: -15.9, east: -46.6, north: -15.2 },
  south: { west: -52.1, south: -30.4, east: -50.8, north: -29.8 },
  small: { west: -43.21, south: -22.95, east: -43.2, north: -22.94 },
};

/** Points on a grid over the view, its corners and edges included. */
function grid({ west, south, east, north }, steps = 60) {
  const points = [];
  for (let i = 0; i <= steps; i++) {
    for (let j = 0; j <= steps; j++) {
      points.push([south + ((north - south) * i) / steps, west + ((east - west) * j) / steps]);
    }
  }
  return points;
}

for (const [name, view] of Object.entries(views)) {
  test(`every tile with a point of the ${name} view is in its covering`, () => {
    const covering = new Set(tilesInView(h3, view));
    for (const [lat, lng] of grid(view)) {
      const tile = h3.latLngToCell(lat, lng, TILE_RESOLUTION);
      assert.ok(covering.has(tile), `tile ${tile} at ${lat}, ${lng} is missing`);
    }
  });
}

test("a 1920x1080 view at MIN_ZOOM overlaps about 50 tiles", () => {
  // At zoom 10 a 512-pixel world spans 360 / (512 * 2^10) degrees of longitude per pixel.
  const degrees = 360 / (512 * 2 ** 10);
  const lat = -15.5;
  const width = 1920 * degrees;
  const height = 1080 * degrees * Math.cos((lat * Math.PI) / 180);
  const view = { west: -47.9, south: lat - height / 2, east: -47.9 + width, north: lat + height / 2 };
  const count = tilesInView(h3, view).length;
  assert.ok(count >= 35 && count <= 70, `${count} tiles`);
});
