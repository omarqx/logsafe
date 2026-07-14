// @vitest-environment jsdom
// Presentational smoke tests: given bins/errors/viewport props, Minimap
// renders that many DOM elements and reports pointer interactions back as
// plain data (a fraction, or an error seq) — it does no index/seq math
// itself. No scroll-jump / virtualizer integration tests here (that lives in
// SessionDetailPage and is flaky to assert on jsdom scroll behavior); see
// Task 8's manual walkthrough for that.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { Minimap } from '../components/Minimap'

// See CmdBar.test.tsx for why this is explicit (no `test.globals: true`).
afterEach(cleanup)

describe('Minimap', () => {
  it('renders one density bar per bin and one hit-target per error mark', () => {
    const bins = [
      { top: 0, height: 10, intensity: 1 },
      { top: 20, height: 10, intensity: 0.5 },
      { top: 40, height: 10, intensity: 0.2 },
    ]
    const errors = [
      { top: 15, seq: 3 },
      { top: 55, seq: 9 },
    ]
    const { container } = render(
      <Minimap
        bins={bins}
        errors={errors}
        viewportTop={0}
        viewportHeight={30}
        onJump={() => {}}
        onJumpToError={() => {}}
      />,
    )
    expect(container.querySelectorAll('.mm-density i')).toHaveLength(bins.length)
    expect(container.querySelectorAll('.mm-err-hit')).toHaveLength(errors.length)
  })

  it('applies bin intensity as opacity and bin top/height as position', () => {
    const bins = [{ top: 25, height: 10, intensity: 0.7 }]
    const { container } = render(
      <Minimap bins={bins} errors={[]} viewportTop={0} viewportHeight={10} onJump={() => {}} onJumpToError={() => {}} />,
    )
    const bar = container.querySelector('.mm-density i') as HTMLElement
    expect(bar.style.top).toBe('25%')
    expect(bar.style.height).toBe('10%')
    expect(bar.style.opacity).toBe('0.7')
  })

  it('positions the viewport indicator from viewportTop/viewportHeight', () => {
    const { container } = render(
      <Minimap bins={[]} errors={[]} viewportTop={30} viewportHeight={34} onJump={() => {}} onJumpToError={() => {}} />,
    )
    const view = container.querySelector('.mm-view') as HTMLElement
    expect(view.style.top).toBe('30%')
    expect(view.style.height).toBe('34%')
  })

  it('renders no bins/errors when given empty arrays (empty session)', () => {
    const { container } = render(
      <Minimap bins={[]} errors={[]} viewportTop={0} viewportHeight={100} onJump={() => {}} onJumpToError={() => {}} />,
    )
    expect(container.querySelectorAll('.mm-density i')).toHaveLength(0)
    expect(container.querySelectorAll('.mm-err-hit')).toHaveLength(0)
  })

  it('sets a title tooltip with the seq on each error mark', () => {
    const { container } = render(
      <Minimap
        bins={[]}
        errors={[{ top: 40, seq: 77 }]}
        viewportTop={0}
        viewportHeight={100}
        onJump={() => {}}
        onJumpToError={() => {}}
      />,
    )
    const mark = container.querySelector('.mm-err-hit') as HTMLElement
    expect(mark.title).toContain('77')
  })

  it('calls onJumpToError (not onJump) when an error mark is pointer-pressed', () => {
    const onJump = vi.fn()
    const onJumpToError = vi.fn()
    const { container } = render(
      <Minimap
        bins={[]}
        errors={[{ top: 40, seq: 77 }]}
        viewportTop={0}
        viewportHeight={100}
        onJump={onJump}
        onJumpToError={onJumpToError}
      />,
    )
    const mark = container.querySelector('.mm-err-hit') as HTMLElement
    mark.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(onJumpToError).toHaveBeenCalledWith(77)
    expect(onJump).not.toHaveBeenCalled()
  })
})
