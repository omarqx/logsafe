import { createContext, useContext, type ComponentType, type ReactNode } from 'react'

export interface SessionSummary {
  id: string
  label: string | null
  first_ts: number
  last_ts: number
  duration_ms: number
  status: 'active' | 'idle'
  event_count: number
  error_count: number
  warn_count: number
  sources: string[]
  types: string[]
}

export interface StoredEvent {
  seq: number
  session_id: string
  ts: number
  received_at: number
  source: string
  ns: string
  level: 'debug' | 'info' | 'warn' | 'error'
  msg: string
  ctx: unknown
  trace: string | null
  type: string
}

export interface EventsPage { events: StoredEvent[]; next_after_seq: number | null }

export interface CoreApi {
  fetchEventsPage(sessionId: string, params: URLSearchParams, afterSeq?: number, limit?: number): Promise<EventsPage>
  getSession(id: string): Promise<SessionSummary | null>
  exportUrl(sessionId: string, params: URLSearchParams): string
}

export type PluginFetch = <T = unknown>(path: string, init?: RequestInit) => Promise<T>

export interface ThemeTokens {
  bg: string; bgRaise: string; txt: string; dim: string; faint: string; line: string
  phos: string; amber: string; err: string
  sources: string[]
  rowH: string
}

export interface FlatLogViewProps {
  sessionId: string
  session: SessionSummary | null
  baseFilters?: { ns?: string; level?: string; source?: string; type?: string }
}

export interface SessionEventsState {
  events: StoredEvent[]
  loading: boolean
  tail: 'live' | 'paused'
  pause(): void
  resume(): void
  error: string | null
}

export interface ListRowProps {
  session: SessionSummary
  now: number
  selected: boolean
  onOpen(): void
  onSelect(): void
  api: CoreApi
  pluginFetch: PluginFetch
}

export interface DetailViewProps {
  session: SessionSummary | null
  sessionId: string
  api: CoreApi
  pluginFetch: PluginFetch
  urlState: {
    params: URLSearchParams
    setParams(next: URLSearchParams, opts?: { replace?: boolean }): void
  }
  tokens: ThemeTokens
}

export interface UIPlugin {
  type: string
  ListRow?: ComponentType<ListRowProps>
  DetailView?: ComponentType<DetailViewProps>
}

/** What core supplies at the app root so the facades below resolve. */
export interface LogsafeRuntime {
  api: CoreApi
  makePluginFetch(pluginId: string): PluginFetch
  FlatLogView: ComponentType<FlatLogViewProps>
  useSessionEvents(sessionId: string, filters?: URLSearchParams): SessionEventsState
  tokens: ThemeTokens
}

const RuntimeContext = createContext<LogsafeRuntime | null>(null)

export function LogsafeRuntimeProvider({ value, children }: { value: LogsafeRuntime; children: ReactNode }) {
  return <RuntimeContext.Provider value={value}>{children}</RuntimeContext.Provider>
}

function useRuntime(): LogsafeRuntime {
  const rt = useContext(RuntimeContext)
  if (!rt) throw new Error('logsafe plugin UI must render inside <LogsafeRuntimeProvider>')
  return rt
}

export function useCoreApi(): CoreApi { return useRuntime().api }
export function useThemeTokens(): ThemeTokens { return useRuntime().tokens }
export function usePluginFetch(pluginId: string): PluginFetch { return useRuntime().makePluginFetch(pluginId) }
export function useSessionEvents(sessionId: string, filters?: URLSearchParams): SessionEventsState {
  return useRuntime().useSessionEvents(sessionId, filters)
}
export function FlatLogView(props: FlatLogViewProps) {
  const Impl = useRuntime().FlatLogView
  return <Impl {...props} />
}
