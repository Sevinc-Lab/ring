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

/** Upload a browser-recorded live clip (webm) to the worker, which saves it as
 *  an event. Body is the raw recording bytes. */
export async function proxyRecord(
  device: string,
  seconds: number,
  body: ArrayBuffer,
): Promise<Response> {
  const params = new URLSearchParams()
  if (device) params.set('device', device)
  if (seconds) params.set('seconds', String(seconds))
  try {
    const r = await fetch(`${WORKER_LIVE_URL}/live/record?${params}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body,
    })
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
