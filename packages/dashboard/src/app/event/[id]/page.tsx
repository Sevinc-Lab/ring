import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getEvent } from '@/lib/db'
import { fmtTime, fmtColdStart, statusClass, labelText, labelClass } from '@/lib/format'

export const dynamic = 'force-dynamic'

export default function EventPage({ params }: { params: { id: string } }) {
  const id = Number.parseInt(params.id, 10)
  if (Number.isNaN(id)) notFound()

  let ev
  try {
    ev = getEvent(id)
  } catch {
    ev = undefined
  }
  if (!ev) notFound()

  const thumbUrl = ev.thumb_path ? `/api/media/${ev.thumb_path}` : undefined

  return (
    <div className="wrap detail">
      <Link href="/" className="back">
        ← Timeline
      </Link>

      <h1>
        {(ev.device_name ?? 'Kamera') + ' · ' + ev.kind}
      </h1>
      <p className="when">{fmtTime(ev.started_at)}</p>

      {ev.clip_path ? (
        <div className="player">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video controls preload="metadata" poster={thumbUrl} src={`/api/media/${ev.clip_path}`} />
        </div>
      ) : (
        <div className="noclip">
          Kein Clip vorhanden (Status: <strong>{ev.recording_status}</strong>).
          {thumbUrl ? (
            <div className="player" style={{ marginTop: 16 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={thumbUrl} alt="" />
            </div>
          ) : null}
        </div>
      )}

      <dl className="facts">
        <dt>Status</dt>
        <dd>
          <span className={`badge ${statusClass(ev.recording_status)}`}>{ev.recording_status}</span>
        </dd>
        <dt>Label</dt>
        <dd>
          <span className={`badge ${labelClass(ev.label)}`}>{labelText(ev.label)}</span>
        </dd>
        <dt>Clip-Länge</dt>
        <dd>{ev.clip_seconds != null ? `${ev.clip_seconds} s` : '–'}</dd>
        <dt>Cold-Start</dt>
        <dd>{fmtColdStart(ev.cold_start_ms)}</dd>
        <dt>Gerät</dt>
        <dd>{ev.device_id}</dd>
        <dt>Clip</dt>
        <dd>{ev.clip_path ?? '–'}</dd>
      </dl>
    </div>
  )
}
