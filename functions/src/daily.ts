// The daily job: publishes the private cells into the public cells by the rule in [publish], then
// writes every public cell into the map tiles. Its storage is behind [PublishStore]; the tiles are
// its only public output.
import { isDeepStrictEqual } from "node:util";
import { type CellState, type PublicCell, publish, tiles } from "./aggregate.js";

/**
 * What the job keeps between runs, private because [held] lists where one install was seen.
 * [held] and [lastBatch] are those returned by the last [publish]; [runMs] is the time of the run
 * that stored them, null before the first, so that two runs that compute the same [held] and
 * [lastBatch] still tell each other apart, and so that the cells staged under that run are known
 * to be public.
 */
export type DailyState = { held: string[]; lastBatch: string | null; runMs: number | null };

/**
 * Where the job reads the private cells and keeps its state and the public cells. A run stages the
 * public cells it changed under its time, stores its state, then copies them into the public cells.
 */
export interface PublishStore {
  /** Every private cell, keyed by resolution 12 H3 cell. */
  privateCells(): Promise<Record<string, CellState>>;
  state(): Promise<DailyState>;
  /** Every public cell, keyed by resolution 11 H3 cell. */
  publicCells(): Promise<Record<string, PublicCell>>;
  /** Writes [cells] staged under the run at [runMs], in one write. */
  stage(runMs: number, cells: Record<string, PublicCell>): Promise<void>;
  /** Every cell staged under the run at [runMs]. */
  staged(runMs: number): Promise<Record<string, PublicCell>>;
  /** In one transaction, if the stored state still equals [expected]: writes [next]. Returns whether it wrote. */
  commit(expected: DailyState, next: DailyState): Promise<boolean>;
  /**
   * In one transaction, if the stored state's `runMs` is still [runMs]: writes [cells] into the
   * public cells. Returns whether it wrote.
   */
  writePublic(runMs: number, cells: Record<string, PublicCell>): Promise<boolean>;
  /** Deletes every cell staged under the run at [runMs] or an earlier one. */
  dropStaged(runMs: number): Promise<void>;
  /** Replaces the public file of the H3 region tile [tile] with [cells]. */
  writeTile(tile: string, cells: PublicCell[]): Promise<void>;
}

/** How many public cells one write holds at most, which keeps it far below Firestore's 10 MiB request limit. */
export const CELLS_PER_WRITE = 400;

/** How many tile files are written at once. */
const TILE_WRITES = 32;

function chunks(cells: Record<string, PublicCell>): Record<string, PublicCell>[] {
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
async function applyStaged(store: PublishStore, runMs: number, cells: Record<string, PublicCell>): Promise<void> {
  for (const chunk of chunks(cells)) {
    if (!(await store.writePublic(runMs, chunk))) throw new Error("runDaily: the state changed during the run");
  }
  await store.dropStaged(runMs);
}

/**
 * One run at [nowMs]. It first finishes copying the stored run's staged cells into the public
 * cells. Then it runs [publish] over every private cell, stages the public cells that changed and
 * only then stores the returned `held` and `lastBatch`, so the state and the public cells never get
 * out of step: a run that stops before storing its state leaves both as they were, and one that
 * stops after has its cells copied by the next run. Throws, storing no state, when another run
 * changed the state since this one read it, or when [publish] throws. After copying its cells,
 * every tile of [tiles] over all the public cells is written, so a tile whose write failed is
 * written again by the next run; throws, after trying every tile, when any tile write failed.
 */
export async function runDaily(store: PublishStore, nowMs: number): Promise<void> {
  const state = await store.state();
  if (state.runMs !== null) await applyStaged(store, state.runMs, await store.staged(state.runMs));
  const [cells, previous] = await Promise.all([store.privateCells(), store.publicCells()]);
  const { held, published, lastBatch } = publish(cells, state.held, previous, state.lastBatch, nowMs);
  const changed = Object.fromEntries(Object.entries(published).filter(([h3, cell]) => !isDeepStrictEqual(cell, previous[h3])));
  for (const chunk of chunks(changed)) await store.stage(nowMs, chunk);
  if (!(await store.commit(state, { held, lastBatch, runMs: nowMs }))) {
    throw new Error("runDaily: the state changed during the run; nothing was published");
  }
  await applyStaged(store, nowMs, changed);
  const files = Object.entries(tiles(published));
  let failed = 0;
  for (let i = 0; i < files.length; i += TILE_WRITES) {
    const results = await Promise.allSettled(files.slice(i, i + TILE_WRITES).map(([tile, cells]) => store.writeTile(tile, cells)));
    failed += results.filter((r) => r.status === "rejected").length;
  }
  if (failed > 0) throw new Error(`runDaily: ${failed} of ${files.length} tile writes failed`);
}
