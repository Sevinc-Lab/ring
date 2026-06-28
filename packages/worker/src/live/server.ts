import { createServer, type IncomingMessage } from 'http'
import type { RingCamera } from 'ring-client-api'
import type { Logger } from '../log'
import type { LiveManager } from './liveManager'
import type { WebRtcManager } from './webrtcManager'

function readBody(req: IncomingMessage, limit = 200_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (c) => {
      data += c
      if (data.length > limit) reject(new Error('body too large'))
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

/**
 * Live control plane, reachable from the dashboard over the compose network
 * (http://ring-worker:<port>); not published to the host.
 *
 *   POST /live/webrtc?device=<id>   body=offer SDP  -> { sdp: answer }   (two-way)
 *   POST /live/keepalive?device=<id>                -> 200
 *   POST /live/start?device=<id>                    -> { path }          (HLS fallback)
 *   POST /live/stop?device=<id>                     -> 200
 */
export function startLiveServer(
  port: number,
  cameras: RingCamera[],
  managers: { hls: LiveManager; webrtc: WebRtcManager },
  log: Logger,
): void {
  const byId = new Map(cameras.map((c) => [String(c.id), c]))
  const fallback = cameras[0]
  const { hls, webrtc } = managers

  const server = createServer((req, res) => {
    const send = (code: number, body: unknown) => {
      res.writeHead(code, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    const fail = (err: unknown) => {
      log.error({ err }, 'live request failed')
      send(500, { error: String(err instanceof Error ? err.message : err) })
    }
    try {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const device = url.searchParams.get('device') ?? ''
      const camera = byId.get(device) ?? fallback
      const id = camera ? String(camera.id) : ''

      if (req.method !== 'POST') return send(404, { error: 'not found' })
      if (!camera) return send(404, { error: 'no camera' })

      switch (url.pathname) {
        case '/live/webrtc':
          readBody(req)
            .then((offer) => webrtc.negotiate(camera, offer))
            .then((answer) => send(200, { sdp: answer, deviceId: id }))
            .catch(fail)
          return
        case '/live/keepalive':
          webrtc.keepAlive(id)
          hls.keepAlive(id)
          return send(200, { ok: true })
        case '/live/start':
          hls
            .start(camera)
            .then((path) => send(200, { path, deviceId: id }))
            .catch(fail)
          return
        case '/live/stop':
          void webrtc.stop(id)
          hls.stop(id)
          return send(200, { ok: true })
        default:
          return send(404, { error: 'not found' })
      }
    } catch (err) {
      fail(err)
    }
  })

  server.on('error', (err) => log.error({ err, port }, 'live server error'))
  server.listen(port, '0.0.0.0', () => log.info({ port }, 'Live control server listening'))
}
