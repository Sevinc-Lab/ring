import { createServer } from 'http'
import type { RingCamera } from 'ring-client-api'
import type { Logger } from '../log'
import type { LiveManager } from './liveManager'

/**
 * Tiny HTTP control plane for live view, reachable from the dashboard container
 * over the compose network (http://ring-worker:<port>). Not published to the host.
 *
 *   POST /live/start?device=<id>  -> { path }   (starts or keep-alives)
 *   POST /live/stop?device=<id>   -> 200
 */
export function startLiveServer(
  port: number,
  cameras: RingCamera[],
  live: LiveManager,
  log: Logger,
): void {
  const byId = new Map(cameras.map((c) => [String(c.id), c]))
  const fallback = cameras[0]

  const server = createServer((req, res) => {
    const send = (code: number, body: unknown) => {
      res.writeHead(code, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    try {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const device = url.searchParams.get('device') ?? ''
      const camera = byId.get(device) ?? fallback

      if (req.method === 'POST' && url.pathname === '/live/start') {
        if (!camera) return send(404, { error: 'no camera' })
        live
          .start(camera)
          .then((path) => send(200, { path, deviceId: String(camera.id) }))
          .catch((err) => {
            log.error({ err }, 'live start failed')
            send(500, { error: String(err instanceof Error ? err.message : err) })
          })
        return
      }
      if (req.method === 'POST' && url.pathname === '/live/stop') {
        if (camera) live.stop(String(camera.id))
        return send(200, { ok: true })
      }
      send(404, { error: 'not found' })
    } catch (err) {
      send(500, { error: String(err instanceof Error ? err.message : err) })
    }
  })

  server.on('error', (err) => log.error({ err, port }, 'live server error'))
  server.listen(port, '0.0.0.0', () => log.info({ port }, 'Live control server listening'))
}
