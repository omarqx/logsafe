// The filter/command line: active filters as removable chips, a free-text
// input that parses `key:value` tokens into chips on Enter (bare words →
// q), and the ts-mode segmented control. All mutations flow out through
// onChangeFilters/onChangeTsMode — this component never touches the URL
// itself (SessionDetailPage owns useUrlState).
import { useCallback, useState, type KeyboardEvent, type Ref } from 'react'
import type { Filters } from '../lib/filters'
import type { TsMode } from '../lib/time'
import { parseCmdInput } from '../lib/cmdInput'

export interface CmdBarProps {
  filters: Filters
  onChangeFilters: (next: Filters) => void
  tsMode: TsMode
  onChangeTsMode: (mode: TsMode) => void
  inputRef?: Ref<HTMLInputElement>
}

const TS_MODES: TsMode[] = ['abs', 'rel', 'delta']
const TS_LABELS: Record<TsMode, string> = { abs: 'abs', rel: 'rel', delta: 'Δ' }

export function CmdBar({ filters, onChangeFilters, tsMode, onChangeTsMode, inputRef }: CmdBarProps) {
  const [text, setText] = useState('')

  const removeFilter = useCallback(
    (key: keyof Filters) => {
      onChangeFilters({ ...filters, [key]: undefined })
    },
    [filters, onChangeFilters],
  )

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key !== 'Enter') return
      const trimmed = text.trim()
      if (trimmed === '') return
      const parsed = parseCmdInput(trimmed)
      onChangeFilters({
        ...filters,
        ...parsed.filters,
        ...(parsed.q ? { q: parsed.q } : {}),
      })
      setText('')
    },
    [text, filters, onChangeFilters],
  )

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
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
      />

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
