import { WORKER_LIVE_URL } from './live'

const jsonHeaders = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }

/**
 * Ask the worker to delete one event LOCALLY (clip + thumbnail + DB row). The
 * worker owns the writable DB + media mount; the dashboard is read-only, so it
 * proxies the request. This never touches Ring's servers.
 */
export async function proxyDeleteEvent(id: number): Promise<Response> {
  return proxyDeleteEvents([id])
}

/** Queue events for re-detection (reset to unclassified so the detector
 *  reprocesses them with the current model). all=true for every recorded clip. */
export async function proxyRelabel(ids: number[], all: boolean): Promise<Response> {
  const q = all ? 'all=1' : `ids=${encodeURIComponent(ids.filter((n) => n > 0).join(','))}`
  try {
    const r = await fetch(`${WORKER_LIVE_URL}/events/relabel?${q}`, { method: 'POST' })
    return new Response(await r.text(), { status: r.status, headers: jsonHeaders })
  } catch {
    return new Response(JSON.stringify({ error: 'worker unreachable' }), {
      status: 502,
      headers: jsonHeaders,
    })
  }
}

/** Delete several events at once (clip + thumbnail + DB row each, local only). */
export async function proxyDeleteEvents(ids: number[]): Promise<Response> {
  const list = ids.filter((n) => Number.isInteger(n) && n > 0).join(',')
  try {
    const r = await fetch(`${WORKER_LIVE_URL}/events/delete?ids=${encodeURIComponent(list)}`, {
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
