const TZ = process.env.TZ || 'Europe/Berlin'

/** Render an ISO8601 UTC timestamp in the configured timezone. Server-only. */
export function fmtTime(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleString('de-DE', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function fmtColdStart(ms: number | null): string {
  if (ms == null) return '–'
  return `${(ms / 1000).toFixed(1)} s`
}

/** Visual class suffix for a recording_status badge. */
export function statusClass(status: string): string {
  switch (status) {
    case 'recorded':
      return 'ok'
    case 'failed':
      return 'fail'
    case 'pending':
      return 'pending'
    default:
      return 'muted' // event_only and anything else
  }
}

/** Human text for an event kind. */
export function kindText(kind: string): string {
  switch (kind) {
    case 'motion':
      return 'Bewegung'
    case 'ding':
      return '🔔 Klingel'
    case 'live':
      return 'Live'
    default:
      return kind
  }
}

/** Human label text (M4b). */
export function labelText(label: string): string {
  switch (label) {
    case 'person':
      return '🧍 Person'
    case 'none':
      return 'keine Person'
    case 'dog':
      return '🐕 Hund'
    case 'cat':
      return '🐈 Katze'
    case 'car':
      return '🚗 Auto'
    case 'unclassified':
      return 'unklassifiziert'
    case 'error':
      return 'Fehler'
    case 'parcel':
      return '📦 Paket'
    default:
      return label
  }
}

/** Visual class suffix for a label badge. */
export function labelClass(label: string): string {
  switch (label) {
    case 'person':
    case 'parcel':
      return 'person'
    case 'dog':
    case 'cat':
      return 'animal'
    case 'car':
      return 'person'
    case 'error':
      return 'fail'
    case 'none':
      return 'muted'
    default:
      return 'pending' // unclassified (not yet processed)
  }
}
