// The filter/command line: active filters as removable chips, a free-text
// input that parses `key:value` tokens into chips on Enter (bare words →
// q), an autocomplete dropdown driven by lib/suggest.ts, and the ts-mode
// segmented control. All mutations flow out through
// onChangeFilters/onChangeTsMode — this component never touches the URL
// itself (SessionDetailPage owns useUrlState).
import { useCallback, useMemo, useState, type KeyboardEvent, type Ref } from 'react'
import type { Filters } from '../lib/filters'
import type { TsMode } from '../lib/time'
import { parseCmdInput } from '../lib/cmdInput'
import { suggest, type Suggestion, type SuggestContext } from '../lib/suggest'

export interface CmdBarProps {
  filters: Filters
  onChangeFilters: (next: Filters) => void
  tsMode: TsMode
  onChangeTsMode: (mode: TsMode) => void
  inputRef?: Ref<HTMLInputElement>
  suggestCtx?: SuggestContext
}

const TS_MODES: TsMode[] = ['abs', 'rel', 'delta']
const TS_LABELS: Record<TsMode, string> = { abs: 'abs', rel: 'rel', delta: 'Δ' }

// Chip display order; 'after' included for forward compatibility (Task 3)
// but only keys present in Filters will be considered for removal.
const CHIP_ORDER = ['after', 'ns', 'level', 'source', 'trace', 'q'] as const

// Stable identity so an omitted `suggestCtx` prop doesn't churn the
// `suggest()` useMemo below on every render.
const EMPTY_SUGGEST_CTX: SuggestContext = { sources: [], nsValues: [], traceValues: [] }

/**
 * Split `text` into everything up to the current token and the token
 * itself — the trailing run of non-whitespace characters (possibly empty,
 * if `text` is empty or ends in whitespace). `prefix + token === text`
 * always holds, so accepting a suggestion is just `prefix + insert(+' ')`.
 */
function splitLastToken(text: string): { prefix: string; token: string } {
  const m = /\S*$/.exec(text)
  const token = m ? m[0] : ''
  return { prefix: text.slice(0, text.length - token.length), token }
}

/** Key completions (`ns:`, `level:`, …) end with the bare colon; value completions don't. */
function isKeyCompletion(insert: string): boolean {
  return insert.endsWith(':')
}

export function CmdBar({ filters, onChangeFilters, tsMode, onChangeTsMode, inputRef, suggestCtx }: CmdBarProps) {
  const [text, setText] = useState('')
  const [focused, setFocused] = useState(false)
  // Esc dismisses the currently-shown list without blurring; typing again
  // (or refocusing) brings it back. null = "no highlight yet" (plain Enter
  // still commits, per the interaction contract in the spec).
  const [dismissed, setDismissed] = useState(false)
  const [highlight, setHighlight] = useState<number | null>(null)

  const { token: currentToken } = useMemo(() => splitLastToken(text), [text])
  const items = useMemo(() => suggest(currentToken, suggestCtx ?? EMPTY_SUGGEST_CTX), [currentToken, suggestCtx])
  // Empty-but-focused shows the key-prefix suggestions (discoverability);
  // empty-and-unfocused must never show anything.
  const dropdownOpen = focused && !dismissed && items.length > 0

  // items can shrink reactively (live tail evicts old trace ids from the
  // suggestion pool) while a row is highlighted — clamp before deref.
  const effectiveHighlight = highlight === null ? null : items.length === 0 ? null : Math.min(highlight, items.length - 1)

  const removeFilter = useCallback(
    (key: keyof Filters) => {
      onChangeFilters({ ...filters, [key]: undefined })
    },
    [filters, onChangeFilters],
  )

  const acceptSuggestion = useCallback(
    (item: Suggestion) => {
      const { prefix } = splitLastToken(text)
      const suffix = isKeyCompletion(item.insert) ? '' : ' '
      setText(prefix + item.insert + suffix)
      setHighlight(null)
      setDismissed(false)
    },
    [text],
  )

  const commit = useCallback(() => {
    const trimmed = text.trim()
    if (trimmed === '') return
    const parsed = parseCmdInput(trimmed)
    onChangeFilters({
      ...filters,
      ...parsed.filters,
      ...(parsed.q ? { q: parsed.q } : {}),
    })
    setText('')
    setHighlight(null)
    setDismissed(false)
  }, [text, filters, onChangeFilters])

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setText(e.target.value)
    setHighlight(null)
    setDismissed(false)
  }, [])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (dropdownOpen && e.key === 'ArrowDown') {
        e.preventDefault()
        setHighlight((h) => {
          const clamped = h === null ? null : items.length === 0 ? null : Math.min(h, items.length - 1)
          return clamped === null ? 0 : (clamped + 1) % Math.max(items.length, 1)
        })
        return
      }
      if (dropdownOpen && e.key === 'ArrowUp') {
        e.preventDefault()
        setHighlight((h) => {
          const clamped = h === null ? null : items.length === 0 ? null : Math.min(h, items.length - 1)
          return clamped === null ? items.length - 1 : (clamped - 1 + items.length) % Math.max(items.length, 1)
        })
        return
      }
      if (dropdownOpen && effectiveHighlight !== null && (e.key === 'Tab' || e.key === 'Enter')) {
        e.preventDefault()
        acceptSuggestion(items[effectiveHighlight])
        return
      }
      if (e.key === 'Escape') {
        if (dropdownOpen) {
          // Close locally only — do NOT let this reach the document-level
          // Esc handlers (SessionDetailPage blurs, Shell closes the cheat
          // sheet) which would blur the input on the first Esc press.
          e.stopPropagation()
          setDismissed(true)
          setHighlight(null)
        }
        // Dropdown already closed: let it bubble, today's blur-on-Esc stands.
        return
      }
      if (e.key === 'Backspace' && text === '') {
        // Find the last filter chip in display order and remove it
        let lastChipKey: typeof CHIP_ORDER[number] | undefined
        for (let i = CHIP_ORDER.length - 1; i >= 0; i--) {
          const k = CHIP_ORDER[i]
          if (k in filters && (filters as Record<string, unknown>)[k] !== undefined) {
            lastChipKey = k
            break
          }
        }
        if (lastChipKey) {
          e.preventDefault()
          // Type guard: lastChipKey is a valid key only if it's in filters
          removeFilter(lastChipKey as keyof Filters)
        }
        return
      }
      if (e.key === 'Enter') {
        commit()
        return
      }
    },
    [dropdownOpen, highlight, items, acceptSuggestion, commit, text, removeFilter],
  )

  const handleFocus = useCallback(() => {
    setFocused(true)
    setDismissed(false)
  }, [])

  const handleBlur = useCallback(() => {
    setFocused(false)
  }, [])

  return (
    <div className="cmdline">
      <span className="prompt">❯</span>

      {filters.ns && (
        <span className="chip on">
          ns:{filters.ns}{' '}
          <span className="x" onClick={() => removeFilter('ns')}>
            ×
          </span>
        </span>
      )}
      {filters.level && (
        <span className={`chip ${filters.level.split(',').includes('error') ? 'on-err' : 'on'}`}>
          level:{filters.level}{' '}
          <span className="x" onClick={() => removeFilter('level')}>
            ×
          </span>
        </span>
      )}
      {filters.source && (
        <span className="chip on">
          source:{filters.source}{' '}
          <span className="x" onClick={() => removeFilter('source')}>
            ×
          </span>
        </span>
      )}
      {filters.trace && (
        <span className="chip on">
          trace:{filters.trace}{' '}
          <span className="x" onClick={() => removeFilter('trace')}>
            ×
          </span>
        </span>
      )}
      {filters.q && (
        <span className="chip on">
          {filters.q}{' '}
          <span className="x" onClick={() => removeFilter('q')}>
            ×
          </span>
        </span>
      )}

      <input
        ref={inputRef}
        className="freetext-input"
        type="text"
        value={text}
        placeholder="ns:auth:* level:error …"
        aria-label="filter or search"
        role="combobox"
        aria-expanded={dropdownOpen}
        aria-autocomplete="list"
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        onBlur={handleBlur}
      />

      {dropdownOpen && (
        <div className="suggest-panel" role="listbox">
          {items.map((item, i) => (
            <div
              key={item.insert}
              role="option"
              aria-selected={i === effectiveHighlight}
              className={`suggest-row${i === effectiveHighlight ? ' highlight' : ''}`}
              // onMouseDown (not onClick) fires before the input's blur, so
              // clicking a suggestion accepts it instead of just closing the
              // dropdown via loss of focus first.
              onMouseDown={(e) => {
                e.preventDefault()
                acceptSuggestion(item)
              }}
            >
              <span className="suggest-label">{item.label}</span>
              {item.hint && <span className="hint">{item.hint}</span>}
            </div>
          ))}
        </div>
      )}

      <span className="right">
        <span className="tsmode">
          {TS_MODES.map((mode) => (
            <span key={mode} className={mode === tsMode ? 'on' : ''} onClick={() => onChangeTsMode(mode)}>
              {TS_LABELS[mode]}
            </span>
          ))}
        </span>
        <kbd>/</kbd> search <kbd>f</kbd> filter <kbd>e</kbd> errors <kbd>p</kbd> pin <kbd>t</kbd> time
      </span>
    </div>
  )
}
