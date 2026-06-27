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
