import type { UIPlugin, ListRowProps, DetailViewProps } from '@coglet/logsafe-plugin-sdk/ui'
import { FlatLogView } from '@coglet/logsafe-plugin-sdk/ui'

function HelloRow({ session, selected, onOpen, onSelect }: ListRowProps) {
  return (
    <div className={`row${selected ? ' selected' : ''}`} onClick={() => { onSelect(); onOpen() }}>
      <span className="status active">●</span>
      <span className="label">{session.label ?? session.id}</span>
      <span className="src src-0" style={{ color: 'var(--phos)' }}>👋 hello · {session.event_count} evts</span>
    </div>
  )
}
function HelloDetail({ session, sessionId }: DetailViewProps) {
  return (
    <>
      <div style={{ padding: '8px 20px', color: 'var(--phos)' }}>
        👋 Hello plugin — custom view for {session?.label ?? sessionId}
      </div>
      <FlatLogView sessionId={sessionId} session={session} />
    </>
  )
}
const plugin: UIPlugin = { type: 'hello', ListRow: HelloRow, DetailView: HelloDetail }
export default plugin
