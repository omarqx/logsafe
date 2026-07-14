import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './theme.css'
import { Shell } from './Shell'
import { SessionListPage } from './routes/SessionListPage'
import { SessionDetailPage } from './routes/SessionDetailPage'

const rootEl = document.getElementById('root')
if (!rootEl) {
  throw new Error('#root element not found')
}

createRoot(rootEl).render(
  <StrictMode>
    <BrowserRouter>
      <Shell>
        <Routes>
          <Route path="/" element={<SessionListPage />} />
          <Route path="/s/:id" element={<SessionDetailPage />} />
        </Routes>
      </Shell>
    </BrowserRouter>
  </StrictMode>,
)
