// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { CmdBar } from '../components/CmdBar'

// @testing-library/react's auto-cleanup registers via a global `afterEach`,
// which this repo's vitest config doesn't enable (no `test.globals: true`)
// — clean up explicitly so each test starts from an empty document.
afterEach(cleanup)

describe('CmdBar', () => {
  it('parses key:value tokens into filter chips and bare words into q on Enter', () => {
    const onChangeFilters = vi.fn()
    render(<CmdBar filters={{}} onChangeFilters={onChangeFilters} tsMode="rel" onChangeTsMode={() => {}} />)

    const input = screen.getByLabelText('filter or search') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'ns:auth:* level:error text' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onChangeFilters).toHaveBeenCalledTimes(1)
    expect(onChangeFilters).toHaveBeenCalledWith({ ns: 'auth:*', level: 'error', q: 'text' })
    // input clears after a successful parse/commit
    expect(input.value).toBe('')
  })

  it('merges parsed tokens onto existing filters rather than replacing them', () => {
    const onChangeFilters = vi.fn()
    render(
      <CmdBar
        filters={{ source: 'api' }}
        onChangeFilters={onChangeFilters}
        tsMode="rel"
        onChangeTsMode={() => {}}
      />,
    )
    const input = screen.getByLabelText('filter or search')
    fireEvent.change(input, { target: { value: 'ns:payment.*' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChangeFilters).toHaveBeenCalledWith({ source: 'api', ns: 'payment.*' })
  })

  it('does nothing on Enter with empty/whitespace-only input', () => {
    const onChangeFilters = vi.fn()
    render(<CmdBar filters={{}} onChangeFilters={onChangeFilters} tsMode="rel" onChangeTsMode={() => {}} />)
    const input = screen.getByLabelText('filter or search')
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChangeFilters).not.toHaveBeenCalled()
  })

  it('renders active filters as chips, tinting an error-inclusive level chip', () => {
    render(
      <CmdBar
        filters={{ ns: 'payment.*', level: 'warn,error', trace: 'req-1' }}
        onChangeFilters={() => {}}
        tsMode="abs"
        onChangeTsMode={() => {}}
      />,
    )
    expect(screen.getByText(/ns:payment\.\*/)).toBeTruthy()
    const levelChip = screen.getByText(/level:warn,error/).closest('.chip')
    expect(levelChip?.className).toContain('on-err')
    expect(screen.getByText(/trace:req-1/)).toBeTruthy()
  })

  it('removes a filter when its chip × is clicked', () => {
    const onChangeFilters = vi.fn()
    render(
      <CmdBar
        filters={{ ns: 'payment.*', trace: 'req-1' }}
        onChangeFilters={onChangeFilters}
        tsMode="abs"
        onChangeTsMode={() => {}}
      />,
    )
    const nsChip = screen.getByText(/ns:payment\.\*/).closest('.chip')!
    const xButton = nsChip.querySelector('.x')!
    fireEvent.click(xButton)
    expect(onChangeFilters).toHaveBeenCalledWith({ ns: undefined, trace: 'req-1' })
  })

  it('calls onChangeTsMode when a ts segment is clicked', () => {
    const onChangeTsMode = vi.fn()
    render(<CmdBar filters={{}} onChangeFilters={() => {}} tsMode="rel" onChangeTsMode={onChangeTsMode} />)
    fireEvent.click(screen.getByText('Δ'))
    expect(onChangeTsMode).toHaveBeenCalledWith('delta')
  })
})
