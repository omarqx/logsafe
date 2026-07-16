// logsafe-plugin-http — UI side. HttpListRow: summary badge fetched from the
// plugin's own route. HttpDetailView: summary strip + SVG request timeline
// (click a bar -> trace filter via urlState) + the core FlatLogView composed
// beneath. Plain SVG, themed only via the SDK tokens — no chart library.
import { useEffect, useState } from 'react'
import type { UIPlugin, ListRowProps, DetailViewProps, PluginFetch } from '@coglet/logsafe-plugin-sdk/ui'
import { FlatLogView } from '@coglet/logsafe-plugin-sdk/ui'
import { layoutTimeline, barColor, MAX_TIMELINE_ROWS } from './timeline'
import type { HttpRequestRow } from './server'

interface Summary { request_count: number; error_count: number; avg_latency_ms: number; max_latency_ms: number }

const SUMMARY_POLL_MS = 5000
const SVG_WIDTH = 700
const AXIS_START = 130
const ROW_H = 18

function useHttpData(sessionId: string, pluginFetch: PluginFetch, withRequests: boolean) {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [requests, setRequests] = useState<HttpRequestRow[]>([])
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const s = await pluginFetch<Summary>(`/summary/${encodeURIComponent(sessionId)}`)
        if (!cancelled) setSummary(s)
        if (withRequests) {
          const r = await pluginFetch<{ requests: HttpRequestRow[] }>(`/requests/${encodeURIComponent(sessionId)}`)
          if (!cancelled) setRequests(r.requests)
        }
      } catch (err) {
        console.error('[plugin-http] fetch failed:', err)
      }
    }
    void load()
    const iv = setInterval(() => void load(), SUMMARY_POLL_MS)
    return () => { cancelled = true; clearInterval(iv) }
  }, [sessionId, pluginFetch, withRequests])
  return { summary, requests }
}

function pct(n: number, of: number): string {
  return of === 0 ? '0%' : `${Math.round((n / of) * 100)}%`
}

function HttpListRow({ session, now: _now, selected, onOpen, onSelect, pluginFetch }: ListRowProps) {
  const { summary } = useHttpData(session.id, pluginFetch, false)
  return (
    <div className={`row${selected ? ' selected' : ''}`} onClick={() => { onSelect(); onOpen() }}>
      <span className={`status ${session.status}`}>●</span>
      <span className="label">{session.label ?? session.id}</span>
      <span style={{ color: 'var(--phos)', fontSize: '11px' }}>
        ⚡ http{summary ? ` · ${summary.request_count} reqs · ${pct(summary.error_count, summary.request_count)} err · avg ${summary.avg_latency_ms}ms` : ' · …'}
      </span>
    </div>
  )
}

function HttpDetailView({ session, sessionId, pluginFetch, urlState, tokens }: DetailViewProps) {
  const { summary, requests } = useHttpData(sessionId, pluginFetch, true)
  const rows = layoutTimeline(requests, { width: SVG_WIDTH, axisStart: AXIS_START })
  const svgHeight = 24 + rows.length * ROW_H

  const filterTrace = (trace: string) => {
    const next = new URLSearchParams(urlState.params)
    next.set('trace', trace)
    urlState.setParams(next, { replace: false })
  }

  return (
    <>
      <div style={{ padding: '8px 20px', color: tokens.phos, fontFamily: 'inherit', fontSize: '12px' }}>
        ⚡ http{summary ? ` — ${summary.request_count} reqs · ${pct(summary.error_count, summary.request_count)} err · avg ${summary.avg_latency_ms}ms · max ${summary.max_latency_ms}ms` : ' — loading…'}
        {requests.length > MAX_TIMELINE_ROWS && (
          <span style={{ color: tokens.dim }}> · showing latest {MAX_TIMELINE_ROWS} of {requests.length}</span>
        )}
      </div>
      {rows.length > 0 && (
        <svg viewBox={`0 0 ${SVG_WIDTH} ${svgHeight}`} style={{ width: '100%', display: 'block', padding: '0 20px 8px', boxSizing: 'border-box' }} role="img">
          <title>HTTP request timeline</title>
          <line x1={AXIS_START} y1={12} x2={SVG_WIDTH - 10} y2={12} stroke={tokens.line} />
          {rows.map((row) => (
            <g key={row.request.trace} transform={`translate(0, ${24 + row.y * ROW_H})`}>
              <text x={4} y={9} fontSize={10} fill={tokens.dim} fontFamily="inherit">
                {row.request.method ?? '?'} {row.request.path ?? ''}
              </text>
              <rect
                data-testid="timeline-bar"
                x={row.x} y={0} width={row.width} height={10} rx={2}
                fill={barColor(row.request, tokens)}
                style={{ cursor: 'pointer' }}
                onClick={() => filterTrace(row.request.trace)}
              />
              <text x={row.x + row.width + 6} y={9} fontSize={9} fill={tokens.dim} fontFamily="inherit">
                {row.request.latency_ms ?? '?'}ms · {row.request.status ?? '—'}
              </text>
            </g>
          ))}
        </svg>
      )}
      <FlatLogView sessionId={sessionId} session={session} />
    </>
  )
}

const plugin: UIPlugin = { type: 'http', ListRow: HttpListRow, DetailView: HttpDetailView }
export default plugin
