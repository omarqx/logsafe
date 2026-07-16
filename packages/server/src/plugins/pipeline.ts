import type { NormalizedEvent } from '../normalize.js'
import type { StoredEvent as CoreStoredEvent } from '../ingest.js'
import type { IncomingEvent, StoredEvent as SdkStoredEvent } from '@coglet/logsafe-plugin-sdk/server'
import type { LoadedServerPlugin } from './loader.js'

/** NormalizedEvent.ctx is a JSON string|null; IncomingEvent.ctx is parsed. */
function toIncoming(ev: NormalizedEvent, raw: Record<string, unknown>): IncomingEvent {
  return {
    session_id: ev.session_id, ts: ev.ts, received_at: ev.received_at,
    source: ev.source, ns: ev.ns, level: ev.level, msg: ev.msg,
    ctx: ev.ctx === null ? null : JSON.parse(ev.ctx),
    trace: ev.trace, type: ev.type, raw,
  }
}

function fromIncoming(base: NormalizedEvent, inc: IncomingEvent): NormalizedEvent {
  return {
    ...base,
    ns: inc.ns, level: inc.level, msg: inc.msg, trace: inc.trace, type: inc.type,
    ctx: inc.ctx === undefined || inc.ctx === null ? null : JSON.stringify(inc.ctx),
  }
}

function ownerFor(type: string, plugins: LoadedServerPlugin[]): LoadedServerPlugin | undefined {
  return plugins.find((p) => p.manifest.ownedTypes.includes(type))
}

/** Rule 2/3 of design §2.2: if still 'generic', run matchers in priority order;
 *  then let the owning plugin transform the event. */
export function classifyAndTransform(
  ev: NormalizedEvent, raw: Record<string, unknown>, plugins: LoadedServerPlugin[],
): NormalizedEvent {
  let type = ev.type
  if (type === 'generic') {
    for (const p of plugins) {
      const t = p.plugin.matchType?.(toIncoming({ ...ev, type: 'generic' }, raw))
      if (t) { type = t; break }
    }
  }
  let out: NormalizedEvent = type === ev.type ? ev : { ...ev, type }
  const owner = ownerFor(type, plugins)
  if (owner?.plugin.transform) {
    const patched = owner.plugin.transform(toIncoming(out, raw))
    if (patched) out = fromIncoming(out, patched)
  }
  return out
}

/** Group stored events by owning plugin and dispatch afterInsert. */
export function runAfterInsert(stored: CoreStoredEvent[], plugins: LoadedServerPlugin[]): void {
  for (const p of plugins) {
    if (!p.plugin.afterInsert) continue
    const mine = stored.filter((e) => p.manifest.ownedTypes.includes(e.type))
    if (mine.length > 0) p.plugin.afterInsert(mine as unknown as SdkStoredEvent[], p.ctx)
  }
}
