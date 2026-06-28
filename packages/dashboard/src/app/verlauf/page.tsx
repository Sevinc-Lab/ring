import Link from 'next/link'
import {
  listEvents,
  countEvents,
  listDevices,
  normalizeLabel,
  type EventRow,
  type DeviceRow,
  type LabelFilter,
} from '@/lib/db'
import { fmtTime, statusClass, labelText, labelClass } from '@/lib/format'
import CameraSelect from './CameraSelect'
import VerlaufList, { type VEvent } from './VerlaufList'

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

function toView(e: EventRow): VEvent {
  return {
    id: e.id,
    thumbUrl: e.thumb_path ? `/api/media/${e.thumb_path}` : null,
    hasClip: !!e.clip_path,
    time: fmtTime(e.started_at),
    sub: (e.device_name ?? 'Kamera') + ' · ' + e.kind,
    labelText: labelText(e.label),
    labelClass: labelClass(e.label),
    status: e.recording_status,
    statusClass: statusClass(e.recording_status),
  }
}

function load(page: number, label: LabelFilter, device: string) {
  try {
    const dev = device || undefined
    const total = countEvents(label, dev)
    const counts: Record<string, number> = {}
    for (const f of FILTERS) counts[f.key] = f.key === label ? total : countEvents(f.key, dev)
    const events = listEvents(PAGE_SIZE, (page - 1) * PAGE_SIZE, label, dev)
    let cams: DeviceRow[] = []
    try {
      cams = listDevices()
    } catch {
      cams = []
    }
    return { events, total, counts, cams, ok: true }
  } catch {
    return {
      events: [] as EventRow[],
      total: 0,
      counts: {} as Record<string, number>,
      cams: [] as DeviceRow[],
      ok: false,
    }
  }
}

export default function VerlaufPage({
  searchParams,
}: {
  searchParams: { page?: string; label?: string; device?: string }
}) {
  const label = normalizeLabel(searchParams.label)
  const device = searchParams.device ?? ''
  const page = Math.max(1, Number.parseInt(searchParams.page ?? '1', 10) || 1)
  const { events, total, counts, cams, ok } = load(page, label, device)
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  // Preserve the camera filter across label-chips and pagination links.
  const dq = device ? `&device=${encodeURIComponent(device)}` : ''
  const qs = (p: number) => `/verlauf?label=${label}${dq}&page=${p}`

  return (
    <div className="wrap">
      <div className="topbar">
        <h1>Verlauf</h1>
        <span className="count">
          {ok ? `${total} Event${total === 1 ? '' : 's'}` : 'Datenbank noch nicht verfügbar'}
        </span>
        {ok ? (
          <CameraSelect
            cams={cams.map((c) => ({ id: c.device_id, name: c.device_name ?? c.device_id }))}
            selected={device}
            label={label}
          />
        ) : null}
      </div>

      {ok ? (
        <nav className="filters">
          {FILTERS.map((f) => (
            <Link
              key={f.key}
              href={`/verlauf?label=${f.key}${dq}`}
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
        <VerlaufList events={events.map(toView)} />
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
