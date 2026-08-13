/**
 * A ~30-line observable store for the DOM chrome.
 *
 * Chrome is vanilla DOM (no framework, per the stack), so this is the whole
 * state mechanism: components subscribe, the bootstrap and the engine's events
 * write. Stories 3.3/3.4 add slices by extending the state shape — appending
 * fields, never reshaping the ones already here.
 */

export type Listener<T> = (state: T) => void;

export interface Store<T> {
  getState(): T;
  /** Merge a patch and notify subscribers. */
  setState(patch: Partial<T>): void;
  /** Subscribe; the listener fires immediately with the current state. */
  subscribe(listener: Listener<T>): () => void;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<Listener<T>>();

  return {
    getState: () => state,
    setState(patch) {
      state = { ...state, ...patch };
      for (const listener of [...listeners]) listener(state);
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
  };
}

/** What the 2.5 chrome needs to draw itself (FR-13, UX-DR6). */
export interface ChromeState {
  readonly repoName: string;
  readonly files: number;
  readonly loc: number;
  readonly commits: number;
  /** Derived from the node set, not from `repo.stats` — AC-4 says so. */
  readonly modules: number;
  readonly languages: Readonly<Record<string, number>>;
  /** True while the layout is settling; the replay control reads it. */
  readonly settling: boolean;
}
