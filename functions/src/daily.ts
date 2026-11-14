// The daily job: publishes the private cells into the public cells by the rule in [publish]. Its
// storage is behind [PublishStore]; the public cells it stores are the only output meant for tiles.
import { isDeepStrictEqual } from "node:util";
import { type CellState, type PublicCell, publish } from "./aggregate.js";

/**
 * What the job keeps between runs, private because [held] lists where one install was seen.
 * [held] and [lastBatch] are those returned by the last [publish]; [runMs] is the time of the run
 * that stored them, null before the first, so that two runs that compute the same [held] and
 * [lastBatch] still tell each other apart.
 */
export type DailyState = { held: string[]; lastBatch: string | null; runMs: number | null };

/** Where the job reads the private cells and keeps its state and the public cells. */
export interface PublishStore {
  /** Every private cell, keyed by resolution 12 H3 cell. */
  privateCells(): Promise<Record<string, CellState>>;
  state(): Promise<DailyState>;
  /** Every public cell, keyed by resolution 11 H3 cell. */
  publicCells(): Promise<Record<string, PublicCell>>;
  /**
   * In one transaction, if the stored state still equals [expected]: writes [next] and the public
   * cells [changed]. Returns whether it wrote anything.
   */
  commit(expected: DailyState, next: DailyState, changed: Record<string, PublicCell>): Promise<boolean>;
}

/**
 * One run at [nowMs]: [publish] over every private cell, then the returned `held`, `lastBatch`
 * and the public cells that changed are written together, so they never get out of step. Throws,
 * writing nothing, when another run changed the state since this one read it, or when [publish]
 * throws.
 */
export async function runDaily(store: PublishStore, nowMs: number): Promise<void> {
  const [state, cells, previous] = await Promise.all([store.state(), store.privateCells(), store.publicCells()]);
  const { held, published, lastBatch } = publish(cells, state.held, previous, state.lastBatch, nowMs);
  const changed = Object.fromEntries(Object.entries(published).filter(([h3, cell]) => !isDeepStrictEqual(cell, previous[h3])));
  if (!(await store.commit(state, { held, lastBatch, runMs: nowMs }, changed))) {
    throw new Error("runDaily: the state changed during the run; nothing was written");
  }
}
