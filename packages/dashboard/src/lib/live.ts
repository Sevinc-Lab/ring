/** Worker live-control server, reachable over the compose network. */
export const WORKER_LIVE_URL = (process.env.WORKER_LIVE_URL || 'http://ring-worker:8081').replace(
  /\/+$/,
  '',
)

const jsonHeaders = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }

/** Simple POST proxy (start / stop / keepalive — no body). */
export async function proxyLive(action: 'start' | 'stop' | 'keepalive', device: string): Promise<Response> {
  const q = device ? `?device=${encodeURIComponent(device)}` : ''
  try {
    const r = await fetch(`${WORKER_LIVE_URL}/live/${action}${q}`, { method: 'POST' })
    return new Response(await r.text(), { status: r.status, headers: jsonHeaders })
  } catch {
    return new Response(JSON.stringify({ error: 'worker unreachable' }), {
      status: 502,
      headers: jsonHeaders,
    })
  }
}

/** WebRTC SDP exchange: forward the browser offer, return the worker's answer. */
export async function proxyWebRtc(device: string, offerSdp: string): Promise<Response> {
  const q = device ? `?device=${encodeURIComponent(device)}` : ''
  try {
    const r = await fetch(`${WORKER_LIVE_URL}/live/webrtc${q}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/sdp' },
      body: offerSdp,
    })
    return new Response(await r.text(), { status: r.status, headers: jsonHeaders })
  } catch {
    return new Response(JSON.stringify({ error: 'worker unreachable' }), {
      status: 502,
      headers: jsonHeaders,
    })
  }
}
