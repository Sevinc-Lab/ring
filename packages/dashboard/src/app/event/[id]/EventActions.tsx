'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Download + delete actions for one event. Delete is LOCAL only — it removes
 * the clip, thumbnail and DB row on CasaOS via the worker. It never touches
 * Ring's cloud. Requires a confirm click.
 */
export default function EventActions({ id, clipPath }: { id: number; clipPath: string | null }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function onDelete() {
    if (!window.confirm('Diese Aufnahme lokal von CasaOS löschen? (Ring bleibt unberührt.)')) return
    setBusy(true)
    setError('')
    try {
      const r = await fetch(`/api/events/delete?id=${id}`, { method: 'POST' })
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        setError(e.error ? `Löschen fehlgeschlagen: ${e.error}` : 'Löschen fehlgeschlagen.')
        setBusy(false)
        return
      }
      // Gone — back to the history, refreshed so the tile disappears.
      router.push('/verlauf')
      router.refresh()
    } catch {
      setError('Worker nicht erreichbar.')
      setBusy(false)
    }
  }

  return (
    <div className="eventActions">
      {clipPath ? (
        <a className="actBtn download" href={`/api/media/${clipPath}?download=1`} download>
          ⬇ Herunterladen
        </a>
      ) : null}
      <button type="button" className="actBtn delete" onClick={onDelete} disabled={busy}>
        {busy ? '… löscht' : '🗑 Lokal löschen'}
      </button>
      {error ? <span className="liveerr">⚠ {error}</span> : null}
    </div>
  )
}
