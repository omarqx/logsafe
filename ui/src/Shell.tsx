import type { ReactNode } from 'react'

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="frame">
      <header>
        <span className="logo">
          logsafe
          <span className="cursor" />
        </span>
      </header>
      {children}
    </div>
  )
}
