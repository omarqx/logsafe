import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { isModifierKeyEvent } from './lib/keyboard'
import { CheatSheet } from './components/CheatSheet'

function isTyping(el: Element | null): boolean {
  if (el === null) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || (el as HTMLElement).isContentEditable
}

export function Shell({ children }: { children: ReactNode }) {
  const [helpOpen, setHelpOpen] = useState(false)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (isModifierKeyEvent(e)) return
      if (e.key === 'Escape') {
        setHelpOpen(false)
        return
      }
      // `?` is Shift+/ (some environments report key '/' with shiftKey). It's
      // not a plain-typing key outside inputs, so it's a safe global toggle.
      // Ignore it while typing in the filter box.
      if ((e.key === '?' || (e.key === '/' && e.shiftKey)) && !isTyping(document.activeElement)) {
        e.preventDefault()
        setHelpOpen((v) => !v)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="frame">
      <header>
        <Link className="logo" to="/" title="Back to sessions">
          logsafe
          <span className="cursor" />
        </Link>
        <button className="help-btn" onClick={() => setHelpOpen(true)} title="Cheat sheet (?)">
          ? cheat sheet
        </button>
      </header>
      {children}
      <CheatSheet open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  )
}
