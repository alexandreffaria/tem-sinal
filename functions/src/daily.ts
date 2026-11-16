// The daily job: publishes the private cells into the public cells by the rule in [publish], then
// writes every public cell into the map tiles and the overview. Its storage is behind
// [PublishStore]; the tiles and the overview are its only public output.
import { isDeepStrictEqual } from "node:util";
import { type CellState, type OverviewCell, type PublicCell, OVERVIEW_RESOLUTIONS, overview, publish, tiles } from "./aggregate.js";

/**
 * What the job keeps between runs: [runMs] is the time of the run that stored it, null before the
 * first, so that the cells staged under that run are known to be public; [tiles] is every tile
 * file a run has written, so that one left with no cells is still written.
 */
export type DailyState = { runMs: number | null; tiles: string[] };

/** The state in the stored document [data], which may be missing or lack either field. */
export function dailyState(data: unknown): DailyState {
  const { runMs, tiles } = (data as { runMs?: unknown; tiles?: unknown } | undefined) ?? {};
  return {
    runMs: typeof runMs === "number" ? runMs : null,
    tiles: Array.isArray(tiles) ? tiles.filter((tile): tile is string => typeof tile === "string") : [],
  };
}

/**
 * Where the job reads the private cells and keeps its state and the public cells. A run stages the
 * public cells it changed under its time, stores its state, then copies them into the public cells.
 * A cell staged as null is one to delete.
 */
export interface PublishStore {
  /** Every private cell, as its resolution 12 H3 cell and its state: one per session that reached the H3 cell. */
  privateCells(): Promise<[string, CellState][]>;
  state(): Promise<DailyState>;
  /** Every public cell, keyed by resolution 11 H3 cell. */
  publicCells(): Promise<Record<string, PublicCell>>;
  /** Writes [cells] staged under the run at [runMs], in one write. */
  stage(runMs: number, cells: Record<string, PublicCell | null>): Promise<void>;
  /** Every cell staged under the run at [runMs]. */
  staged(runMs: number): Promise<Record<string, PublicCell | null>>;
  /** In one transaction, if the stored state still equals [expected]: writes [next]. Returns whether it wrote. */
  commit(expected: DailyState, next: DailyState): Promise<boolean>;
  /**
   * In one transaction, if the stored state's `runMs` is still [runMs]: writes [cells] into the
   * public cells, deleting those that are null. Returns whether it wrote.
   */
  writePublic(runMs: number, cells: Record<string, PublicCell | null>): Promise<boolean>;
  /** Deletes every cell staged under the run at [runMs] or an earlier one. */
  dropStaged(runMs: number): Promise<void>;
  /** Replaces the public file of the H3 region tile [tile] with [cells]. */
  writeTile(tile: string, cells: PublicCell[]): Promise<void>;
  /** Replaces the public overview file of H3 resolution [resolution] with [cells]. */
  writeOverview(resolution: number, cells: OverviewCell[]): Promise<void>;
}

/** How many public cells one write holds at most, which keeps it far below Firestore's 10 MiB request limit. */
export const CELLS_PER_WRITE = 400;

/** How many tile files are written at once. */
const TILE_WRITES = 32;

function chunks<T>(cells: Record<string, T>): Record<string, T>[] {
  const entries = Object.entries(cells);
  const result = [];
  for (let i = 0; i < entries.length; i += CELLS_PER_WRITE) result.push(Object.fromEntries(entries.slice(i, i + CELLS_PER_WRITE)));
  return result;
}

/**
 * Copies [cells], staged under the stored run at [runMs], into the public cells, then deletes what
 * is staged under that run and earlier ones. Throws when another run stored its state meanwhile,
 * since that run's public cells may be newer than [cells].
 */
async function applyStaged(store: PublishStore, runMs: number, cells: Record<string, PublicCell | null>): Promise<void> {
  for (const chunk of chunks(cells)) {
    if (!(await store.writePublic(runMs, chunk))) throw new Error("runDaily: the state changed during the run");
  }
  await store.dropStaged(runMs);
}

/**
 * One run at [nowMs]. It first finishes copying the stored run's staged cells into the public
 * cells. Then it runs [publish] over every private cell, stages the public cells that changed and
 * a null for each one no private cell backs any more (a deleted session's), and only then stores
 * its state, so the state and the public cells never get out of step: a run that stops before
 * storing its state leaves both as they were, and one that stops after has its cells copied by the
 * next run. Throws, storing no state, when another run changed the state since this one read it.
 * After copying its cells, it writes every tile of [tiles] over all the public cells, and writes
 * empty every other tile that a run wrote or that held a public cell, so a tile whose write
 * failed is written again by the next run. Then it writes the overview at each of
 * [OVERVIEW_RESOLUTIONS] over all the public cells, every file every run. Throws, after trying
 * every tile and overview file, when any write failed.
 */
export async function runDaily(store: PublishStore, nowMs: number): Promise<void> {
  const state = await store.state();
  if (state.runMs !== null) await applyStaged(store, state.runMs, await store.staged(state.runMs));
  const [cells, previous] = await Promise.all([store.privateCells(), store.publicCells()]);
  const published = publish(cells);
  const changed: Record<string, PublicCell | null> = Object.fromEntries(
    Object.entries(published).filter(([h3, cell]) => !isDeepStrictEqual(cell, previous[h3])),
  );
  for (const h3 of Object.keys(previous)) if (!published[h3]) changed[h3] = null;
  const byTile = tiles(published);
  const names = [...new Set([...state.tiles, ...Object.keys(tiles(previous)), ...Object.keys(byTile)])].sort();
  for (const chunk of chunks(changed)) await store.stage(nowMs, chunk);
  if (!(await store.commit(state, { runMs: nowMs, tiles: names }))) {
    throw new Error("runDaily: the state changed during the run; nothing was published");
  }
  await applyStaged(store, nowMs, changed);
  let failed = 0;
  for (let i = 0; i < names.length; i += TILE_WRITES) {
    const results = await Promise.allSettled(names.slice(i, i + TILE_WRITES).map((tile) => store.writeTile(tile, byTile[tile] ?? [])));
    failed += results.filter((r) => r.status === "rejected").length;
  }
  const overviews = await Promise.allSettled(OVERVIEW_RESOLUTIONS.map((resolution) => store.writeOverview(resolution, overview(published, resolution))));
  failed += overviews.filter((r) => r.status === "rejected").length;
  const files = names.length + OVERVIEW_RESOLUTIONS.length;
  if (failed > 0) throw new Error(`runDaily: ${failed} of ${files} tile and overview writes failed`);
}
