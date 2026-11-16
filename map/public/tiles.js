// What the map fetches for a view: the tiles that cover it, or the overview resolution that fits
// its zoom. A plain module so the page and the tests share it.

/** The H3 resolution of a published tile file: TILE_RESOLUTION in functions/src/aggregate.ts. */
export const TILE_RESOLUTION = 5;

/**
 * From this zoom the map shows the tiles' cells. Below it the view spans too many tiles to fetch:
 * at this zoom a 1920x1080 view overlaps about 55 tiles; at 9 it overlaps about 190.
 */
export const TILE_ZOOM = 10;

/**
 * The overview's resolutions (OVERVIEW_RESOLUTIONS in functions/src/aggregate.ts), each with the
 * zoom it is shown from, finest first. Each one's hexagons are about 20 px across where it takes
 * over and 60 px where the next one does; resolution 6 reaches 100 px at TILE_ZOOM, and resolution
 * 3 is about 20 px across at the page's first zoom, 3.5.
 */
const OVERVIEW_ZOOMS = [[6, 8], [5, 6.5], [4, 5], [3, -Infinity]];

/** The overview resolution to show at [zoom], or null from TILE_ZOOM on. */
export function overviewResolution(zoom) {
  if (zoom >= TILE_ZOOM) return null;
  return OVERVIEW_ZOOMS.find(([, from]) => zoom >= from)[0];
}

/**
 * The tiles that cover the view: every tile that overlaps it, and no other. `h3` is the h3-js
 * library (the page's global, or the npm package in tests); the bounds are in degrees.
 */
export function tilesInView(h3, { west, south, east, north }) {
  const ring = [[west, south], [east, south], [east, north], [west, north], [west, south]];
  return h3.polygonToCellsExperimental(
    [ring], TILE_RESOLUTION, h3.POLYGON_TO_CELLS_FLAGS.containmentOverlapping, true);
}
