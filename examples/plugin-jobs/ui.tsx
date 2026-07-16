// logsafe-plugin-jobs — UI side. Option B visual: stat cards + duration
// sparkline over the composed FlatLogView. Read-only (no urlState use —
// see plugin-http's timeline for click-to-filter). Colors from tokens only.
import { useEffect, useState } from 'react'
import type { UIPlugin, ListRowProps, DetailViewProps, PluginFetch } from '@coglet/logsafe-plugin-sdk/ui'
import { FlatLogView } from '@coglet/logsafe-plugin-sdk/ui'
import { layoutSparkline, pointColor, MAX_SPARKLINE_POINTS, SLOW_MS } from './sparkline'
import type { JobRun } from './server'

interface Summary {
  processed: number; running: number; failed: number
  failure_rate_pct: number; avg_duration_ms: number; max_duration_ms: number
}

const SUMMARY_POLL_MS = 5000
const SPARK_W = 700
const SPARK_H = 60

function useJobsData(sessionId: string, pluginFetch: PluginFetch, withRuns: boolean) {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [runsList, setRunsList] = useState<JobRun[]>([])
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const s = await pluginFetch<Summary>(`/summary/${encodeURIComponent(sessionId)}`)
        if (!cancelled) setSummary(s)
        if (withRuns) {
          const r = await pluginFetch<{ runs: JobRun[] }>(`/durations/${encodeURIComponent(sessionId)}`)
          if (!cancelled) setRunsList(r.runs)
        }
      } catch (err) {
        console.error('[plugin-jobs] fetch failed:', err)
      }
    }
    void load()
    const iv = setInterval(() => void load(), SUMMARY_POLL_MS)
    return () => { cancelled = true; clearInterval(iv) }
  }, [sessionId, pluginFetch, withRuns])
  return { summary, runsList }
}

function JobsListRow({ session, selected, onOpen, onSelect, pluginFetch }: ListRowProps) {
  const { summary } = useJobsData(session.id, pluginFetch, false)
  return (
    <div className={`row${selected ? ' selected' : ''}`} onClick={() => { onSelect(); onOpen() }}>
      <span className={`status ${session.status}`}>●</span>
      <span className="label">{session.label ?? session.id}</span>
      <span style={{ color: 'var(--phos)', fontSize: '11px' }}>
        ⚙ jobs{summary ? ` · ${summary.processed} done · ${summary.failure_rate_pct}% fail · avg ${summary.avg_duration_ms}ms` : ' · …'}
      </span>
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ flex: 1, border: '1px solid var(--line)', borderRadius: 6, padding: '8px 10px' }}>
      <div style={{ fontSize: 9, color: 'var(--dim)' }}>{label}</div>
      <div style={{ fontSize: 18, color: color ?? 'var(--txt)' }}>{value}</div>
    </div>
  )
}

function JobsDetailView({ session, sessionId, pluginFetch, tokens }: DetailViewProps) {
  const { summary, runsList } = useJobsData(sessionId, pluginFetch, true)
  const points = layoutSparkline(runsList, { width: SPARK_W, height: SPARK_H })
  const polyline = points.map((p) => `${p.x},${p.y}`).join(' ')

  return (
    <>
      <div style={{ display: 'flex', gap: 10, padding: '10px 20px', fontFamily: 'inherit' }}>
        <StatCard label="PROCESSED" value={String(summary?.processed ?? '…')} />
        <StatCard label="FAILED %" value={`${summary?.failure_rate_pct ?? '…'}%`}
          color={(summary?.failed ?? 0) > 0 ? tokens.err : undefined} />
        <StatCard label="AVG DUR" value={`${summary?.avg_duration_ms ?? '…'}ms`} />
        <StatCard label="MAX DUR" value={`${summary?.max_duration_ms ?? '…'}ms`}
          color={(summary?.max_duration_ms ?? 0) > SLOW_MS ? tokens.amber : undefined} />
      </div>
      {points.length > 0 && (
        <svg viewBox={`0 0 ${SPARK_W} ${SPARK_H + 8}`} role="img"
          style={{ width: '100%', display: 'block', padding: '0 20px 8px', boxSizing: 'border-box' }}>
          <title>Job duration sparkline</title>
          <line x1={0} y1={SPARK_H + 2} x2={SPARK_W} y2={SPARK_H + 2} stroke={tokens.line} />
          <polyline points={polyline} fill="none" stroke={tokens.phos} strokeWidth={1.5} />
          {points.map((p) => (
            <circle key={p.run.job_id} data-testid="spark-point"
              cx={p.x} cy={p.y} r={3} fill={pointColor(p.run, tokens)} />
          ))}
          {runsList.length > MAX_SPARKLINE_POINTS && (
            <text x={4} y={10} fontSize={9} fill={tokens.dim}>latest {MAX_SPARKLINE_POINTS} of {runsList.length}</text>
          )}
        </svg>
      )}
      <FlatLogView sessionId={sessionId} session={session} />
    </>
  )
}

const plugin: UIPlugin = { type: 'job', ListRow: JobsListRow, DetailView: JobsDetailView }
export default plugin
