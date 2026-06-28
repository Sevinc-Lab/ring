import { getLatestDing } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Returns the most recent doorbell press if it happened in the last 60s, so an
 *  open dashboard can ring. Polled by the DoorbellWatcher. */
export function GET() {
  let ding = null
  try {
    const d = getLatestDing()
    if (d) {
      const ageMs = Date.now() - Date.parse(d.started_at)
      if (ageMs >= 0 && ageMs < 60_000) {
        ding = { id: d.id, deviceId: d.device_id, deviceName: d.device_name, startedAt: d.started_at }
      }
    }
  } catch {
    /* db not ready — no ding */
  }
  return new Response(JSON.stringify({ ding }), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}
