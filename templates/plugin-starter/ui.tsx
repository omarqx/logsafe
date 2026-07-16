// Starter UI plugin. TODO: rename 'my-plugin', then build your row + detail
// view. FlatLogView composes the core log stream under your custom UI.
// Docs: docs/PLUGINS.md (recipes for visuals, live tail, pluginFetch).
import type { UIPlugin, ListRowProps, DetailViewProps } from '@coglet/logsafe-plugin-sdk/ui'
import { FlatLogView } from '@coglet/logsafe-plugin-sdk/ui'

function MyRow({ session, selected, onOpen, onSelect }: ListRowProps) {
  return (
    <div className={`row${selected ? ' selected' : ''}`} onClick={() => { onSelect(); onOpen() }}>
      <span className={`status ${session.status}`}>●</span>
      <span className="label">{session.label ?? session.id}</span>
      {/* TODO: your badge — fetch plugin data via the pluginFetch prop */}
      <span style={{ color: 'var(--phos)' }}>my-plugin · {session.event_count} evts</span>
    </div>
  )
}

function MyDetail({ session, sessionId, tokens }: DetailViewProps) {
  return (
    <>
      {/* TODO: your custom view — see plugin-http's SVG timeline for a visual example */}
      <div style={{ padding: '8px 20px', color: tokens.phos }}>my-plugin — custom view for {session?.label ?? sessionId}</div>
      <FlatLogView sessionId={sessionId} session={session} />
    </>
  )
}

const plugin: UIPlugin = { type: 'my-plugin', ListRow: MyRow, DetailView: MyDetail }
export default plugin
