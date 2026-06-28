import { WORKER_LIVE_URL } from './live'

const jsonHeaders = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }

/** GET the camera's real capabilities (siren/light present?) from the worker. */
export async function proxyCaps(device: string): Promise<Response> {
  const q = device ? `?device=${encodeURIComponent(device)}` : ''
  try {
    const r = await fetch(`${WORKER_LIVE_URL}/device/caps${q}`, { method: 'GET' })
    return new Response(await r.text(), { status: r.status, headers: jsonHeaders })
  } catch {
    return new Response(JSON.stringify({ error: 'worker unreachable' }), {
      status: 502,
      headers: jsonHeaders,
    })
  }
}

/** Toggle siren or light. on=false turns it off. */
export async function proxyControl(
  control: 'siren' | 'light',
  device: string,
  on: boolean,
): Promise<Response> {
  const params = new URLSearchParams()
  if (device) params.set('device', device)
  params.set('on', String(on))
  try {
    const r = await fetch(`${WORKER_LIVE_URL}/device/${control}?${params}`, { method: 'POST' })
    return new Response(await r.text(), { status: r.status, headers: jsonHeaders })
  } catch {
    return new Response(JSON.stringify({ error: 'worker unreachable' }), {
      status: 502,
      headers: jsonHeaders,
    })
  }
}
