import Link from 'next/link'
import { listEvents, countEvents, type EventRow } from '@/lib/db'
import { fmtTime, statusClass } from '@/lib/format'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 60

function loadPage(page: number): { events: EventRow[]; total: number; ok: boolean } {
  try {
    const total = countEvents()
    const events = listEvents(PAGE_SIZE, (page - 1) * PAGE_SIZE)
    return { events, total, ok: true }
  } catch {
    // DB not present yet (worker hasn't recorded anything / volume not mounted)
    return { events: [], total: 0, ok: false }
  }
}

export default function Home({ searchParams }: { searchParams: { page?: string } }) {
  const page = Math.max(1, Number.parseInt(searchParams.page ?? '1', 10) || 1)
  const { events, total, ok } = loadPage(page)
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="wrap">
      <div className="topbar">
        <h1>Ring NVR</h1>
        <span className="count">
          {ok ? `${total} Event${total === 1 ? '' : 's'}` : 'Datenbank noch nicht verfügbar'}
        </span>
      </div>

      {events.length === 0 ? (
        <p className="empty">
          {ok
            ? 'Noch keine Events. Sobald die Kamera Bewegung meldet, erscheinen hier Clips.'
            : 'Warte auf den Worker / die SQLite-Datenbank unter DATA_DB_PATH.'}
        </p>
      ) : (
        <div className="grid">
          {events.map((e) => (
            <Link key={e.id} href={`/event/${e.id}`} className="card">
              <div className="thumb">
                {e.thumb_path ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/media/${e.thumb_path}`} alt="" loading="lazy" />
                ) : (
                  <div className="noThumb">kein Thumbnail</div>
                )}
                {e.clip_path ? <span className="play">▶</span> : null}
              </div>
              <div className="meta">
                <span className="time">{fmtTime(e.started_at)}</span>
                <span className="sub">
                  {(e.device_name ?? 'Kamera') + ' · ' + e.kind}
                </span>
                <span className={`badge ${statusClass(e.recording_status)}`}>
                  {e.recording_status}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {pages > 1 ? (
        <nav className="pager">
          {page > 1 ? (
            <Link href={`/?page=${page - 1}`}>← Neuer</Link>
          ) : (
            <span className="disabled">← Neuer</span>
          )}
          <span>
            Seite {page} / {pages}
          </span>
          {page < pages ? (
            <Link href={`/?page=${page + 1}`}>Älter →</Link>
          ) : (
            <span className="disabled">Älter →</span>
          )}
        </nav>
      ) : null}
    </div>
  )
}
