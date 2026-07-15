// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { LogRow } from '../components/LogRow'
import type { StoredEvent } from '../api'

// See CmdBar.test.tsx for why this is explicit (no `test.globals: true`).
afterEach(cleanup)

function makeEvent(overrides: Partial<StoredEvent> = {}): StoredEvent {
  return {
    seq: 71,
    session_id: 's1',
    ts: 7632,
    received_at: 7633,
    source: 'api',
    ns: 'payment.stripe',
    level: 'error',
    msg: 'upstream 502 from stripe',
    ctx: { attempt: 1, latency_ms: 3021 },
    trace: 'req-mrk8ms-pay',
    type: 'log',
    ...overrides,
  }
}

const noop = () => {}

describe('LogRow', () => {
  it('renders the row anatomy: gutter, ts, source, ns, level, message, ctx preview, trace marker', () => {
    render(
      <LogRow
        ev={makeEvent()}
        sourceIdx={1}
        tsLabel="+07.632"
        isSelected={false}
        isExpanded={false}
        isPinned={false}
        sessionStart={0}
        onSelect={noop}
        onToggleExpand={noop}
        onTraceClick={noop}
      />,
    )
    expect(screen.getByText('+07.632')).toBeTruthy()
    expect(screen.getByText('api')).toBeTruthy()
    expect(screen.getByText('payment.stripe')).toBeTruthy()
    expect(screen.getByText('ERROR')).toBeTruthy() // uppercased for warn/error
    expect(screen.getByText(/upstream 502 from stripe/)).toBeTruthy()
    expect(screen.getByText(/attempt/)).toBeTruthy() // ctx preview
    expect(screen.getByText('req-mrk8ms-pay')).toBeTruthy()
  })

  it('applies is-error / selected row modifier classes', () => {
    const { container } = render(
      <LogRow
        ev={makeEvent({ level: 'error' })}
        sourceIdx={1}
        tsLabel="+07.632"
        isSelected={true}
        isExpanded={false}
        isPinned={false}
        sessionStart={0}
        onSelect={noop}
        onToggleExpand={noop}
        onTraceClick={noop}
      />,
    )
    const row = container.querySelector('.logrow')!
    expect(row.className).toContain('is-error')
    expect(row.className).toContain('selected')
  })

  it('lowercases debug/info level text but uppercases warn/error', () => {
    const { rerender } = render(
      <LogRow
        ev={makeEvent({ level: 'debug', msg: 'x' })}
        sourceIdx={0}
        tsLabel="+00.000"
        isSelected={false}
        isExpanded={false}
        isPinned={false}
        sessionStart={0}
        onSelect={noop}
        onToggleExpand={noop}
        onTraceClick={noop}
      />,
    )
    expect(screen.getByText('debug')).toBeTruthy()

    rerender(
      <LogRow
        ev={makeEvent({ level: 'warn', msg: 'x' })}
        sourceIdx={0}
        tsLabel="+00.000"
        isSelected={false}
        isExpanded={false}
        isPinned={false}
        sessionStart={0}
        onSelect={noop}
        onToggleExpand={noop}
        onTraceClick={noop}
      />,
    )
    expect(screen.getByText('WARN')).toBeTruthy()
  })

  it('calls onSelect with the event seq when the row is clicked', () => {
    const onSelect = vi.fn()
    const { container } = render(
      <LogRow
        ev={makeEvent({ seq: 42 })}
        sourceIdx={0}
        tsLabel="+00.000"
        isSelected={false}
        isExpanded={false}
        isPinned={false}
        sessionStart={0}
        onSelect={onSelect}
        onToggleExpand={noop}
        onTraceClick={noop}
      />,
    )
    fireEvent.click(container.querySelector('.logrow')!)
    expect(onSelect).toHaveBeenCalledWith(42)
  })

  it('calls onToggleExpand (not onSelect) when the caret is clicked', () => {
    const onSelect = vi.fn()
    const onToggleExpand = vi.fn()
    render(
      <LogRow
        ev={makeEvent({ seq: 42 })}
        sourceIdx={0}
        tsLabel="+00.000"
        isSelected={false}
        isExpanded={false}
        isPinned={false}
        sessionStart={0}
        onSelect={onSelect}
        onToggleExpand={onToggleExpand}
        onTraceClick={noop}
      />,
    )
    fireEvent.click(screen.getByText('▸'))
    expect(onToggleExpand).toHaveBeenCalledWith(42)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('renders the CtxPanel when expanded, and does not when collapsed', () => {
    const { container, rerender } = render(
      <LogRow
        ev={makeEvent()}
        sourceIdx={0}
        tsLabel="+00.000"
        isSelected={true}
        isExpanded={false}
        isPinned={false}
        sessionStart={0}
        onSelect={noop}
        onToggleExpand={noop}
        onTraceClick={noop}
      />,
    )
    expect(container.querySelector('.ctxpanel')).toBeNull()

    rerender(
      <LogRow
        ev={makeEvent()}
        sourceIdx={0}
        tsLabel="+00.000"
        isSelected={true}
        isExpanded={true}
        isPinned={false}
        sessionStart={0}
        onSelect={noop}
        onToggleExpand={noop}
        onTraceClick={noop}
      />,
    )
    const panel = container.querySelector('.ctxpanel')
    expect(panel).not.toBeNull()
    expect(panel!.textContent).toContain('"latency_ms"')
  })

  it('shows the pin marker when isPinned is true', () => {
    const { container } = render(
      <LogRow
        ev={makeEvent()}
        sourceIdx={0}
        tsLabel="+00.000"
        isSelected={false}
        isExpanded={false}
        isPinned={true}
        sessionStart={0}
        onSelect={noop}
        onToggleExpand={noop}
        onTraceClick={noop}
      />,
    )
    expect(container.querySelector('.pin')).not.toBeNull()
  })
})
