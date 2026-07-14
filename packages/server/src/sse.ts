import type { StoredEvent } from './ingest.js'

type Listener = (events: StoredEvent[]) => void

export class SseHub {
  private listeners = new Map<string, Set<Listener>>()

  subscribe(sessionId: string, fn: Listener): () => void {
    let set = this.listeners.get(sessionId)
    if (!set) {
      set = new Set()
      this.listeners.set(sessionId, set)
    }
    set.add(fn)
    return () => {
      set.delete(fn)
      if (set.size === 0) this.listeners.delete(sessionId)
    }
  }

  publish(sessionId: string, events: StoredEvent[]): void {
    if (events.length === 0) return
    const set = this.listeners.get(sessionId)
    if (!set) return
    for (const fn of set) fn(events)
  }
}
