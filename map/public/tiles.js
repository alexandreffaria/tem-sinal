// The tiles that cover a map view. A plain module so the page and the tests share it.

/** The H3 resolution of a published tile file: TILE_RESOLUTION in functions/src/aggregate.ts. */
export const TILE_RESOLUTION = 5;

/**
 * The tiles that cover the view: every tile that overlaps it, and no other. `h3` is the h3-js
 * library (the page's global, or the npm package in tests); the bounds are in degrees.
 */
export function tilesInView(h3, { west, south, east, north }) {
  const ring = [[west, south], [east, south], [east, north], [west, north], [west, south]];
  return h3.polygonToCellsExperimental(
    [ring], TILE_RESOLUTION, h3.POLYGON_TO_CELLS_FLAGS.containmentOverlapping, true);
}
