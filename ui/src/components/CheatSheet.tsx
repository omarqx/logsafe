// Cheat-sheet overlay: filter syntax + keyboard shortcuts. Opened with `?`
// or the header button; dismissed with Esc / backdrop click.

type Row = { k: string; d: string }

const FILTERS: Row[] = [
  { k: 'ns:auth:*', d: 'namespace — * wildcard; comma = OR  (ns:payment.*,cart:*)' },
  { k: 'level:warn,error', d: 'level — comma = OR  (debug · info · warn · error)' },
  { k: 'source:vote,api', d: 'source label — comma = OR' },
  { k: 'trace:req-abc', d: 'exact trace id — follows one request across sources' },
  { k: 'stripe   (bare words)', d: 'free text — substring over msg + ctx JSON, case-insensitive' },
  { k: 'q:"label":"Dogs"', d: 'match a ctx field — search its JSON fragment "field":"value"' },
]

const KEYS: Row[] = [
  { k: 'j / k', d: 'move selection (pauses live tail)' },
  { k: 'Enter / o', d: 'expand / collapse ctx JSON' },
  { k: '/', d: 'focus search' },
  { k: 'f', d: 'focus filter input' },
  { k: 'e', d: 'toggle level:warn,error' },
  { k: 'c', d: 'clear view — hide events up to now (remove the chip to restore)' },
  { k: 'p', d: 'pin / unpin selected row (survives filter changes)' },
  { k: 't', d: 'cycle timestamps: absolute → relative → Δ prev' },
  { k: 'g / G', d: 'jump top / bottom  (G resumes live tail)' },
  { k: '⌫ (input empty)', d: 'remove the last filter chip' },
  { k: 'x', d: 'delete session (on the session list)' },
  { k: '? / Esc', d: 'open this cheat sheet / close' },
]

export function CheatSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null
  return (
    <div className="cheat-backdrop" onClick={onClose}>
      <div className="cheat-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="cheat sheet">
        <div className="cheat-head">
          <span className="cheat-title">logsafe · cheat sheet</span>
          <button className="cheat-close" onClick={onClose}>
            esc ✕
          </button>
        </div>

        <div className="cheat-cols">
          <section>
            <h4>
              Filters <em>— type into the ❯ bar as key:value, Enter to apply</em>
            </h4>
            <dl className="cheat-dl">
              {FILTERS.map((r) => (
                <div key={r.k} className="cheat-row">
                  <dt>{r.k}</dt>
                  <dd>{r.d}</dd>
                </div>
              ))}
            </dl>
            <p className="cheat-note">Filters AND together. Copy the URL to share the exact view.</p>
            <p className="cheat-note">
              For structured queries (<code>ctx.total &gt; 10</code>, nested paths), pull{' '}
              <code>…/export.ndjson</code> and pipe through <code>jq 'select(.ctx.total&gt;10)'</code>.
            </p>
          </section>

          <section>
            <h4>Keyboard</h4>
            <dl className="cheat-dl">
              {KEYS.map((r) => (
                <div key={r.k} className="cheat-row">
                  <dt>
                    <kbd>{r.k}</kbd>
                  </dt>
                  <dd>{r.d}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      </div>
    </div>
  )
}
