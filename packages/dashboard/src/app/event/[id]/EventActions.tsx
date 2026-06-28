'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Download + re-detect + delete actions for one event. Delete is LOCAL only
 * (clip + thumbnail + DB row on CasaOS, never Ring). Re-detect resets the event
 * so the detector labels it again with the current model.
 */
export default function EventActions({ id, clipPath }: { id: number; clipPath: string | null }) {
  const router = useRouter()
  const [busy, setBusy] = useState<'' | 'delete' | 'relabel'>('')
  const [error, setError] = useState('')
  const [note, setNote] = useState('')

  async function onDelete() {
    if (!window.confirm('Diese Aufnahme lokal von CasaOS löschen? (Ring bleibt unberührt.)')) return
    setBusy('delete')
    setError('')
    try {
      const r = await fetch(`/api/events/delete?id=${id}`, { method: 'POST' })
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        setError(e.error ? `Löschen fehlgeschlagen: ${e.error}` : 'Löschen fehlgeschlagen.')
        setBusy('')
        return
      }
      router.push('/verlauf')
      router.refresh()
    } catch {
      setError('Worker nicht erreichbar.')
      setBusy('')
    }
  }

  async function onRelabel() {
    setBusy('relabel')
    setError('')
    setNote('')
    try {
      const r = await fetch(`/api/events/relabel?id=${id}`, { method: 'POST' })
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        setError(e.error ? `Fehlgeschlagen: ${e.error}` : 'Neu-Erkennen fehlgeschlagen.')
        return
      }
      setNote('Zur Neu-Erkennung eingereiht — in ein paar Sekunden aktualisieren.')
      router.refresh()
    } catch {
      setError('Worker nicht erreichbar.')
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="eventActions">
      {clipPath ? (
        <a className="actBtn download" href={`/api/media/${clipPath}?download=1`} download>
          ⬇ Herunterladen
        </a>
      ) : null}
      {clipPath ? (
        <button type="button" className="actBtn" onClick={onRelabel} disabled={busy !== ''}>
          {busy === 'relabel' ? '… reiht ein' : '🔄 Neu erkennen'}
        </button>
      ) : null}
      <button type="button" className="actBtn delete" onClick={onDelete} disabled={busy !== ''}>
        {busy === 'delete' ? '… löscht' : '🗑 Lokal löschen'}
      </button>
      {note ? <span className="muted">{note}</span> : null}
      {error ? <span className="liveerr">⚠ {error}</span> : null}
    </div>
  )
}
