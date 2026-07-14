import { useParams } from 'react-router-dom'

export function SessionDetailPage() {
  const { id } = useParams<{ id: string }>()
  return (
    <div style={{ padding: '20px' }}>
      <p className="crumb">
        session detail — coming soon · <b>{id}</b>
      </p>
    </div>
  )
}
