import { WORKER_LIVE_URL } from './live'

const jsonHeaders = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }

/**
 * Ask the worker to delete one event LOCALLY (clip + thumbnail + DB row). The
 * worker owns the writable DB + media mount; the dashboard is read-only, so it
 * proxies the request. This never touches Ring's servers.
 */
export async function proxyDeleteEvent(id: number): Promise<Response> {
  try {
    const r = await fetch(`${WORKER_LIVE_URL}/events/delete?id=${encodeURIComponent(String(id))}`, {
      method: 'POST',
    })
    return new Response(await r.text(), { status: r.status, headers: jsonHeaders })
  } catch {
    return new Response(JSON.stringify({ error: 'worker unreachable' }), {
      status: 502,
      headers: jsonHeaders,
    })
  }
}
