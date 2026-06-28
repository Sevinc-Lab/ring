'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

export interface VEvent {
  id: number
  thumbUrl: string | null
  hasClip: boolean
  time: string
  sub: string
  labelText: string
  labelClass: string
  status: string
  statusClass: string
}

/**
 * Event grid with an optional multi-select mode. "Auswählen" turns the cards
 * into checkboxes; picked events are deleted in one bulk call (clip + thumbnail
 * + DB row each, local only — Ring is never touched).
 */
export default function VerlaufList({ events }: { events: VEvent[] }) {
  const router = useRouter()
  const [selecting, setSelecting] = useState(false)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')

  const toggle = (id: number) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const exit = () => {
    setSelecting(false)
    setPicked(new Set())
    setError('')
  }

  async function remove() {
    if (picked.size === 0) return
    if (!window.confirm(`${picked.size} Aufnahme(n) lokal von CasaOS löschen? (Ring bleibt unberührt.)`))
      return
    setBusy(true)
    setError('')
    try {
      const ids = [...picked].join(',')
      const r = await fetch(`/api/events/delete?ids=${ids}`, { method: 'POST' })
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        setError(e.error ? `Löschen fehlgeschlagen: ${e.error}` : 'Löschen fehlgeschlagen.')
        setBusy(false)
        return
      }
      exit()
      router.refresh()
    } catch {
      setError('Worker nicht erreichbar.')
    } finally {
      setBusy(false)
    }
  }

  async function relabelAll() {
    if (
      !window.confirm(
        'Alle Aufnahmen neu erkennen lassen? Der Detektor verarbeitet sie im Hintergrund mit dem aktuellen Modell — das kann je nach Anzahl etwas dauern.',
      )
    )
      return
    setBusy(true)
    setError('')
    setNote('')
    try {
      const r = await fetch('/api/events/relabel?all=1', { method: 'POST' })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) {
        setError(data.error ? `Fehlgeschlagen: ${data.error}` : 'Neu-Erkennen fehlgeschlagen.')
        return
      }
      setNote(
        `${data.queued ?? 0} Aufnahme(n) eingereiht — werden im Hintergrund neu erkannt. Seite später aktualisieren.`,
      )
      router.refresh()
    } catch {
      setError('Worker nicht erreichbar.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="listBar">
        {selecting ? (
          <>
            <button type="button" className="actBtn" onClick={() => setPicked(new Set(events.map((e) => e.id)))}>
              Alle
            </button>
            <button type="button" className="actBtn" onClick={() => setPicked(new Set())}>
              Keine
            </button>
            <span className="muted">{picked.size} ausgewählt</span>
            <button
              type="button"
              className="actBtn delete"
              onClick={remove}
              disabled={busy || picked.size === 0}
            >
              {busy ? '… löscht' : `🗑 Löschen (${picked.size})`}
            </button>
            <button type="button" className="actBtn" onClick={exit} disabled={busy}>
              Abbrechen
            </button>
          </>
        ) : (
          <>
            <button type="button" className="actBtn" onClick={() => setSelecting(true)}>
              ☑ Auswählen
            </button>
            <button type="button" className="actBtn" onClick={relabelAll} disabled={busy}>
              {busy ? '… reiht ein' : '🔄 Alle neu erkennen'}
            </button>
          </>
        )}
        {note ? <span className="muted">{note}</span> : null}
        {error ? <span className="liveerr">⚠ {error}</span> : null}
      </div>

      <div className="grid">
        {events.map((e) => {
          const inner = (
            <>
              <div className="thumb">
                {e.thumbUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={e.thumbUrl} alt="" loading="lazy" />
                ) : (
                  <div className="noThumb">kein Thumbnail</div>
                )}
                {e.hasClip ? <span className="play">▶</span> : null}
                {selecting ? (
                  <span className={`pick${picked.has(e.id) ? ' on' : ''}`}>
                    {picked.has(e.id) ? '✓' : ''}
                  </span>
                ) : null}
              </div>
              <div className="meta">
                <span className="time">{e.time}</span>
                <span className="sub">{e.sub}</span>
                <span className="badges">
                  <span className={`badge ${e.labelClass}`}>{e.labelText}</span>
                  <span className={`badge ${e.statusClass}`}>{e.status}</span>
                </span>
              </div>
            </>
          )
          return selecting ? (
            <div
              key={e.id}
              className={`card selectable${picked.has(e.id) ? ' selected' : ''}`}
              onClick={() => toggle(e.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(ev) => {
                if (ev.key === 'Enter' || ev.key === ' ') {
                  ev.preventDefault()
                  toggle(e.id)
                }
              }}
            >
              {inner}
            </div>
          ) : (
            <Link key={e.id} href={`/event/${e.id}`} className="card">
              {inner}
            </Link>
          )
        })}
      </div>
    </>
  )
}
