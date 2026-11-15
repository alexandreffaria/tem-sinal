// Fetches and stores the map's tiles: each tile is fetched once at a time, however many loads
// ask for it, and only the latest load's outcome is the one the page reports.

/**
 * A loader over `fetchTile(tile)`, which resolves to the tile's cells (an empty array for a tile
 * with no published cells) or rejects.
 */
export function tileLoader(fetchTile) {
  /** Each requested tile's cells. */
  const tiles = new Map();
  /** Every fetched cell by H3 index. */
  const cells = new Map();
  /**
   * Each tile being fetched, with the fetch that stores its cells; a failed fetch leaves its tile
   * out of all three, so a later load fetches it again.
   */
  const fetching = new Map();
  /** The number of the latest load. */
  let latest = 0;

  /**
   * Fetches the view's tiles that aren't stored yet, waiting on fetches already running for them.
   * The fetches start before this returns, so `fetching` names every tile of the view not stored.
   * Resolves once they have all settled, to whether this is still the latest load and whether any
   * of them failed; the tiles that did load are stored either way.
   */
  async function load(view) {
    const id = ++latest;
    const pending = view.filter((tile) => !tiles.has(tile));
    for (const tile of pending) {
      if (fetching.has(tile)) continue;
      fetching.set(tile, fetchTile(tile).then((published) => {
        tiles.set(tile, published);
        for (const cell of published) cells.set(cell.h3, cell);
      }).finally(() => fetching.delete(tile)));
    }
    const results = await Promise.allSettled(pending.map((tile) => fetching.get(tile)));
    return { latest: id === latest, failed: results.some((r) => r.status === "rejected") };
  }

  return { tiles, cells, fetching, load };
}
