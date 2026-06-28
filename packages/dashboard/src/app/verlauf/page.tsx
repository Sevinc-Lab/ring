import Link from 'next/link'
import {
  listEvents,
  countEvents,
  normalizeLabel,
  type EventRow,
  type LabelFilter,
} from '@/lib/db'
import { fmtTime, statusClass, labelText, labelClass } from '@/lib/format'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 60

const FILTERS: { key: LabelFilter; text: string }[] = [
  { key: 'all', text: 'Alle' },
  { key: 'person', text: '🧍 Person' },
  { key: 'dog', text: '🐕 Hund' },
  { key: 'cat', text: '🐈 Katze' },
  { key: 'none', text: 'keine Person' },
  { key: 'unclassified', text: 'unklassifiziert' },
]

function load(page: number, label: LabelFilter) {
  try {
    const total = countEvents(label)
    const counts: Record<string, number> = {}
    for (const f of FILTERS) counts[f.key] = f.key === label ? total : countEvents(f.key)
    const events = listEvents(PAGE_SIZE, (page - 1) * PAGE_SIZE, label)
    return { events, total, counts, ok: true }
  } catch {
    return { events: [] as EventRow[], total: 0, counts: {} as Record<string, number>, ok: false }
  }
}

export default function VerlaufPage({
  searchParams,
}: {
  searchParams: { page?: string; label?: string }
}) {
  const label = normalizeLabel(searchParams.label)
  const page = Math.max(1, Number.parseInt(searchParams.page ?? '1', 10) || 1)
  const { events, total, counts, ok } = load(page, label)
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const qs = (p: number) => `/verlauf?label=${label}&page=${p}`

  return (
    <div className="wrap">
      <div className="topbar">
        <h1>Verlauf</h1>
        <span className="count">
          {ok ? `${total} Event${total === 1 ? '' : 's'}` : 'Datenbank noch nicht verfügbar'}
        </span>
      </div>

      {ok ? (
        <nav className="filters">
          {FILTERS.map((f) => (
            <Link
              key={f.key}
              href={`/verlauf?label=${f.key}`}
              className={`chip${f.key === label ? ' active' : ''}`}
            >
              {f.text}
              {counts[f.key] != null ? <span className="n">{counts[f.key]}</span> : null}
            </Link>
          ))}
        </nav>
      ) : null}

      {events.length === 0 ? (
        <p className="empty">
          {ok
            ? 'Keine Events für diesen Filter.'
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
                <span className="sub">{(e.device_name ?? 'Kamera') + ' · ' + e.kind}</span>
                <span className="badges">
                  <span className={`badge ${labelClass(e.label)}`}>{labelText(e.label)}</span>
                  <span className={`badge ${statusClass(e.recording_status)}`}>
                    {e.recording_status}
                  </span>
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {pages > 1 ? (
        <nav className="pager">
          {page > 1 ? <Link href={qs(page - 1)}>← Neuer</Link> : <span className="disabled">← Neuer</span>}
          <span>
            Seite {page} / {pages}
          </span>
          {page < pages ? <Link href={qs(page + 1)}>Älter →</Link> : <span className="disabled">Älter →</span>}
        </nav>
      ) : null}
    </div>
  )
}
