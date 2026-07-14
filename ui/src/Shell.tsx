import type { ReactNode } from 'react'

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="frame">
      <header>
        <span className="logo">
          deblog
          <span className="cursor" />
        </span>
      </header>
      {children}
    </div>
  )
}
