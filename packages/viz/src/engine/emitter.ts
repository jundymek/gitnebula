/**
 * A typed event emitter, ~40 lines, because the alternative is a dependency
 * for something the engine needs exactly once. Chrome talks to the engine
 * through this and nothing else (AD-5).
 */

import type {
  GraphEngineEvent,
  GraphEngineEventMap,
  GraphEngineListener,
} from "./types.js";

type AnyListener = (payload: never) => void;

export class Emitter {
  private readonly listeners = new Map<GraphEngineEvent, Set<AnyListener>>();

  on<K extends GraphEngineEvent>(
    event: K,
    listener: GraphEngineListener<K>,
  ): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as AnyListener);
    return () => this.off(event, listener);
  }

  off<K extends GraphEngineEvent>(
    event: K,
    listener: GraphEngineListener<K>,
  ): void {
    this.listeners.get(event)?.delete(listener as AnyListener);
  }

  emit<K extends GraphEngineEvent>(
    event: K,
    payload: GraphEngineEventMap[K],
  ): void {
    const set = this.listeners.get(event);
    if (!set) return;
    // Copy first: a listener that unsubscribes itself must not disturb the
    // iteration it is being called from.
    for (const listener of [...set]) {
      (listener as GraphEngineListener<K>)(payload);
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}
