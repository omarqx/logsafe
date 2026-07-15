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

  it('removes a filter when its chip x is clicked', () => {
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

  it('renders a `cleared` chip first when filters.after is set, with a seq-showing title, and removes it on x click', () => {
    const onChangeFilters = vi.fn()
    render(
      <CmdBar
        filters={{ after: 500, ns: 'payment.*' }}
        onChangeFilters={onChangeFilters}
        tsMode="abs"
        onChangeTsMode={() => {}}
      />,
    )
    const clearedChip = screen.getByText('cleared').closest('.chip')!
    expect(clearedChip.getAttribute('title')).toBe('showing events after seq 500')

    // 'cleared' must render before the 'ns' chip (CHIP_ORDER: after, ns, ...)
    const nsChip = screen.getByText(/ns:payment\.\*/).closest('.chip')!
    expect(clearedChip.compareDocumentPosition(nsChip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    const xButton = clearedChip.querySelector('.x')!
    fireEvent.click(xButton)
    expect(onChangeFilters).toHaveBeenCalledWith({ after: undefined, ns: 'payment.*' })
  })

  it('does not render a `cleared` chip when filters.after is unset', () => {
    render(<CmdBar filters={{}} onChangeFilters={() => {}} tsMode="abs" onChangeTsMode={() => {}} />)
    expect(screen.queryByText('cleared')).toBeNull()
  })

  describe('purge action on the cleared chip', () => {
    it('does not render a purge button when onPurge is not provided', () => {
      render(<CmdBar filters={{ after: 500 }} onChangeFilters={() => {}} tsMode="abs" onChangeTsMode={() => {}} />)
      expect(screen.queryByText('purge')).toBeNull()
    })

    it('renders a purge button with the right title when onPurge is provided and floor is set', () => {
      render(
        <CmdBar
          filters={{ after: 500 }}
          onChangeFilters={() => {}}
          tsMode="abs"
          onChangeTsMode={() => {}}
          onPurge={() => {}}
        />,
      )
      const purgeButton = screen.getByText('purge')
      expect(purgeButton.getAttribute('title')).toBe('permanently delete the hidden events')
      // lives inside the cleared chip, not floating elsewhere
      expect(purgeButton.closest('.chip')).toBe(screen.getByText('cleared').closest('.chip'))
    })

    it('does not render a purge button when onPurge is provided but there is no floor (no cleared chip at all)', () => {
      render(<CmdBar filters={{}} onChangeFilters={() => {}} tsMode="abs" onChangeTsMode={() => {}} onPurge={() => {}} />)
      expect(screen.queryByText('purge')).toBeNull()
    })

    it('calls onPurge when the purge button is clicked, without also removing the chip', () => {
      const onPurge = vi.fn()
      const onChangeFilters = vi.fn()
      render(
        <CmdBar
          filters={{ after: 500 }}
          onChangeFilters={onChangeFilters}
          tsMode="abs"
          onChangeTsMode={() => {}}
          onPurge={onPurge}
        />,
      )
      fireEvent.click(screen.getByText('purge'))
      expect(onPurge).toHaveBeenCalledTimes(1)
      expect(onChangeFilters).not.toHaveBeenCalled()
    })
  })

  it('calls onChangeTsMode when a ts segment is clicked', () => {
    const onChangeTsMode = vi.fn()
    render(<CmdBar filters={{}} onChangeFilters={() => {}} tsMode="rel" onChangeTsMode={onChangeTsMode} />)
    fireEvent.click(screen.getByText('Δ'))
    expect(onChangeTsMode).toHaveBeenCalledWith('delta')
  })

  describe('backspace on empty input', () => {
    it('removes the last filter chip when input is empty', () => {
      const onChangeFilters = vi.fn()
      render(
        <CmdBar
          filters={{ ns: 'auth:*', level: 'error' }}
          onChangeFilters={onChangeFilters}
          tsMode="rel"
          onChangeTsMode={() => {}}
        />,
      )
      const input = screen.getByLabelText('filter or search') as HTMLInputElement
      // Input is empty by default
      expect(input.value).toBe('')
      fireEvent.keyDown(input, { key: 'Backspace' })
      // Should remove the last chip (level), keeping ns
      expect(onChangeFilters).toHaveBeenCalledTimes(1)
      expect(onChangeFilters).toHaveBeenCalledWith({ ns: 'auth:*', level: undefined })
    })

    it('does not remove a chip when input has text and Backspace is pressed', () => {
      const onChangeFilters = vi.fn()
      render(
        <CmdBar
          filters={{ ns: 'auth:*', level: 'error' }}
          onChangeFilters={onChangeFilters}
          tsMode="rel"
          onChangeTsMode={() => {}}
        />,
      )
      const input = screen.getByLabelText('filter or search') as HTMLInputElement
      fireEvent.change(input, { target: { value: 'x' } })
      fireEvent.keyDown(input, { key: 'Backspace' })
      // Should not call onChangeFilters when text is present
      expect(onChangeFilters).not.toHaveBeenCalled()
    })

    it('removes the last-in-CHIP_ORDER chip (q), not `after`, when both are present', () => {
      const onChangeFilters = vi.fn()
      render(
        <CmdBar
          filters={{ after: 500, q: 'search term' }}
          onChangeFilters={onChangeFilters}
          tsMode="rel"
          onChangeTsMode={() => {}}
        />,
      )
      const input = screen.getByLabelText('filter or search') as HTMLInputElement
      fireEvent.keyDown(input, { key: 'Backspace' })
      expect(onChangeFilters).toHaveBeenCalledWith({ after: 500, q: undefined })
    })

    it('removes `after` (the clear floor) once it is the only remaining chip', () => {
      const onChangeFilters = vi.fn()
      render(
        <CmdBar filters={{ after: 500 }} onChangeFilters={onChangeFilters} tsMode="rel" onChangeTsMode={() => {}} />,
      )
      const input = screen.getByLabelText('filter or search') as HTMLInputElement
      fireEvent.keyDown(input, { key: 'Backspace' })
      expect(onChangeFilters).toHaveBeenCalledWith({ after: undefined })
    })

    it('removes the only filter chip when input is empty and there is only q filter', () => {
      const onChangeFilters = vi.fn()
      render(
        <CmdBar
          filters={{ q: 'search term' }}
          onChangeFilters={onChangeFilters}
          tsMode="rel"
          onChangeTsMode={() => {}}
        />,
      )
      const input = screen.getByLabelText('filter or search') as HTMLInputElement
      fireEvent.keyDown(input, { key: 'Backspace' })
      // Should remove the q filter
      expect(onChangeFilters).toHaveBeenCalledTimes(1)
      expect(onChangeFilters).toHaveBeenCalledWith({ q: undefined })
    })

    it('does nothing when input is empty but there are no filters', () => {
      const onChangeFilters = vi.fn()
      render(
        <CmdBar
          filters={{}}
          onChangeFilters={onChangeFilters}
          tsMode="rel"
          onChangeTsMode={() => {}}
        />,
      )
      const input = screen.getByLabelText('filter or search') as HTMLInputElement
      fireEvent.keyDown(input, { key: 'Backspace' })
      // Should not call onChangeFilters when no filters exist
      expect(onChangeFilters).not.toHaveBeenCalled()
    })
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
        // fireEvent.focus alone does not move jsdom's document.activeElement
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

    it("Esc with the dropdown already closed lets the keydown reach the document (today's blur behavior)", () => {
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

    it('handles suggestion list shrinking while a row is highlighted (highlight clamp)', () => {
      const largeCtx = { sources: ['api', 'web'], nsValues: ['auth.login', 'auth.logout', 'auth.refresh'], traceValues: ['t-1', 't-2', 't-3'] }
      const smallCtx = { sources: ['api'], nsValues: [], traceValues: ['t-1'] }

      const { rerender } = render(
        <CmdBar filters={{}} onChangeFilters={() => {}} tsMode="rel" onChangeTsMode={() => {}} suggestCtx={largeCtx} />,
      )
      const input = screen.getByLabelText('filter or search') as HTMLInputElement

      // Focus and type to show trace suggestions
      fireEvent.focus(input)
      fireEvent.change(input, { target: { value: 'trace:' } })
      expect(screen.getAllByRole('option')).toHaveLength(3)

      // Highlight the last item (index 2)
      fireEvent.keyDown(input, { key: 'ArrowDown' })
      fireEvent.keyDown(input, { key: 'ArrowDown' })
      fireEvent.keyDown(input, { key: 'ArrowDown' })

      // Verify last row is highlighted
      const options = screen.getAllByRole('option')
      expect(options[2].className).toContain('highlight')

      // Shrink the suggestion list to 1 item (simulating live tail eviction)
      rerender(
        <CmdBar filters={{}} onChangeFilters={() => {}} tsMode="rel" onChangeTsMode={() => {}} suggestCtx={smallCtx} />,
      )

      // Should have exactly 1 suggestion now
      expect(screen.getAllByRole('option')).toHaveLength(1)

      // Press Enter - should accept the single remaining suggestion without throwing
      fireEvent.keyDown(input, { key: 'Enter' })

      // The single suggestion should be accepted
      expect(input.value).toContain('trace:')
    })
  })
})
