import type { LogsafeRuntime, ThemeTokens, SessionEventsState } from '@coglet/logsafe-plugin-sdk/ui'
import { coreApi, makePluginFetch } from './api'
import { FlatLogView } from './components/FlatLogView'
import { useEventStream } from './hooks/useEventStream'

const tokens: ThemeTokens = {
  bg: 'var(--bg)', bgRaise: 'var(--bg-raise)', txt: 'var(--txt)', dim: 'var(--dim)',
  faint: 'var(--faint)', line: 'var(--line)', phos: 'var(--phos)', amber: 'var(--amber)',
  err: 'var(--err)', rowH: 'var(--row-h)',
  sources: ['var(--cyan)', 'var(--violet)', 'var(--slate)', 'var(--gold)', 'var(--green)', 'var(--rose)'],
}

/** Bridge the core event-stream hook to the SDK's simpler facade shape. */
function useSessionEventsImpl(sessionId: string, filters?: URLSearchParams): SessionEventsState {
  const [state, api] = useEventStream(sessionId, filters ?? new URLSearchParams(), [])
  return { events: state.events, loading: state.loading, tail: state.tail, pause: api.pause, resume: api.resume, error: state.error }
}

export const logsafeRuntime: LogsafeRuntime = {
  api: coreApi,
  makePluginFetch,
  FlatLogView,
  useSessionEvents: useSessionEventsImpl,
  tokens,
}
