/** Worker live-control server, reachable over the compose network. */
export const WORKER_LIVE_URL = (process.env.WORKER_LIVE_URL || 'http://ring-worker:8081').replace(
  /\/+$/,
  '',
)

export async function proxyLive(action: 'start' | 'stop', device: string): Promise<Response> {
  const q = device ? `?device=${encodeURIComponent(device)}` : ''
  try {
    const r = await fetch(`${WORKER_LIVE_URL}/live/${action}${q}`, { method: 'POST' })
    const body = await r.text()
    return new Response(body, {
      status: r.status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    })
  } catch {
    return new Response(JSON.stringify({ error: 'worker unreachable' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
