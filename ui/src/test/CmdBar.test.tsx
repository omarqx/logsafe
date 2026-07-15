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

  describe('autocomplete', () => {
    const suggestCtx = { sources: ['api', 'web'], nsValues: ['auth.login'], traceValues: ['t-1'] }

    it('does not show the dropdown when the input is empty and unfocused', () => {
      render(
        <CmdBar filters={{}} onChangeFilters={() => {}} tsMode="rel" onChangeTsMode={() => {}} suggestCtx={suggestCtx} />,
      )
      expect(screen.queryByRole('listbox')).toBeNull()
    })

    it('shows key-prefix suggestions when the input is empty but focused', () => {
      render(
        <CmdBar filters={{}} onChangeFilters={() => {}} tsMode="rel" onChangeTsMode={() => {}} suggestCtx={suggestCtx} />,
      )
      const input = screen.getByLabelText('filter or search')
      fireEvent.focus(input)
      expect(screen.getByRole('listbox')).toBeTruthy()
      expect(screen.getAllByRole('option')).toHaveLength(5)
    })

    it('ArrowDown + Enter accepts the highlighted suggestion, replacing the last token, without committing', () => {
      const onChangeFilters = vi.fn()
      render(
        <CmdBar
          filters={{}}
          onChangeFilters={onChangeFilters}
          tsMode="rel"
          onChangeTsMode={() => {}}
          suggestCtx={suggestCtx}
        />,
      )
      const input = screen.getByLabelText('filter or search') as HTMLInputElement
      fireEvent.focus(input)
      fireEvent.change(input, { target: { value: 'level:w' } })
      fireEvent.keyDown(input, { key: 'ArrowDown' })
      fireEvent.keyDown(input, { key: 'Enter' })

      // value completion: trailing space, no commit
      expect(input.value).toBe('level:warn ')
      expect(onChangeFilters).not.toHaveBeenCalled()

      // a second, plain Enter (no highlight re-armed) commits the token as today
      fireEvent.keyDown(input, { key: 'Enter' })
      expect(onChangeFilters).toHaveBeenCalledTimes(1)
      expect(onChangeFilters).toHaveBeenCalledWith({ level: 'warn' })
      expect(input.value).toBe('')
    })

    it('plain Enter with no ArrowDown/ArrowUp commits as today, even while the dropdown is showing', () => {
      const onChangeFilters = vi.fn()
      render(
        <CmdBar
          filters={{}}
          onChangeFilters={onChangeFilters}
          tsMode="rel"
          onChangeTsMode={() => {}}
          suggestCtx={suggestCtx}
        />,
      )
      const input = screen.getByLabelText('filter or search') as HTMLInputElement
      fireEvent.focus(input)
      fireEvent.change(input, { target: { value: 'level:warn' } })
      // dropdown is open (level:warn matches) but highlight was never touched
      expect(screen.getByRole('listbox')).toBeTruthy()
      fireEvent.keyDown(input, { key: 'Enter' })
      expect(onChangeFilters).toHaveBeenCalledWith({ level: 'warn' })
      expect(input.value).toBe('')
    })

    it('Tab accepts the highlighted key completion without a trailing space', () => {
      const onChangeFilters = vi.fn()
      render(
        <CmdBar
          filters={{}}
          onChangeFilters={onChangeFilters}
          tsMode="rel"
          onChangeTsMode={() => {}}
          suggestCtx={suggestCtx}
        />,
      )
      const input = screen.getByLabelText('filter or search') as HTMLInputElement
      fireEvent.focus(input)
      fireEvent.change(input, { target: { value: 'ns' } })
      fireEvent.keyDown(input, { key: 'ArrowDown' })
      fireEvent.keyDown(input, { key: 'Tab' })
      expect(input.value).toBe('ns:')
      expect(onChangeFilters).not.toHaveBeenCalled()
    })

    it('clicking a suggestion accepts it', () => {
      render(
        <CmdBar filters={{}} onChangeFilters={() => {}} tsMode="rel" onChangeTsMode={() => {}} suggestCtx={suggestCtx} />,
      )
      const input = screen.getByLabelText('filter or search') as HTMLInputElement
      fireEvent.focus(input)
      fireEvent.change(input, { target: { value: 'level:w' } })
      const option = screen.getByText('warn')
      fireEvent.mouseDown(option)
      expect(input.value).toBe('level:warn ')
    })

    it('Esc closes the dropdown and stops the keydown from reaching a document-level listener, without blurring', () => {
      render(
        <CmdBar filters={{}} onChangeFilters={() => {}} tsMode="rel" onChangeTsMode={() => {}} suggestCtx={suggestCtx} />,
      )
      const input = screen.getByLabelText('filter or search') as HTMLInputElement
      const docHandler = vi.fn()
      document.addEventListener('keydown', docHandler)
      try {
        // fireEvent.focus alone doesn't move jsdom's document.activeElement
        // (unlike a real browser focus) — call .focus() for that, then
        // fireEvent.focus so React's synthetic onFocus handler definitely runs.
        input.focus()
        fireEvent.focus(input)
        expect(screen.getByRole('listbox')).toBeTruthy()
        fireEvent.keyDown(input, { key: 'Escape' })
        expect(screen.queryByRole('listbox')).toBeNull()
        expect(docHandler).not.toHaveBeenCalled()
        expect(document.activeElement).toBe(input)
      } finally {
        document.removeEventListener('keydown', docHandler)
      }
    })

    it('Esc with the dropdown already closed lets the keydown reach the document (today’s blur behavior)', () => {
      render(
        <CmdBar filters={{}} onChangeFilters={() => {}} tsMode="rel" onChangeTsMode={() => {}} suggestCtx={suggestCtx} />,
      )
      const input = screen.getByLabelText('filter or search') as HTMLInputElement
      const docHandler = vi.fn()
      document.addEventListener('keydown', docHandler)
      try {
        // not focused -> dropdown never opens
        fireEvent.keyDown(input, { key: 'Escape' })
        expect(docHandler).toHaveBeenCalledTimes(1)
      } finally {
        document.removeEventListener('keydown', docHandler)
      }
    })
  })
})
