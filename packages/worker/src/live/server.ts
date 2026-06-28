import { createServer, type IncomingMessage } from 'http'
import { unlink } from 'fs/promises'
import { resolve, sep } from 'path'
import type { RingCamera } from 'ring-client-api'
import type { Logger } from '../log'
import type { LiveManager } from './liveManager'
import type { WebRtcManager } from './webrtcManager'
import type { SirenManager } from './sirenManager'
import type { Repository } from '../db/repository'

/** Best-effort unlink of a media file, constrained to mediaRoot. Missing files
 *  are fine (already gone). Returns true if the path was inside the root. */
async function removeMediaFile(mediaRoot: string, rel: string | null): Promise<void> {
  if (!rel) return
  const root = resolve(mediaRoot)
  const abs = resolve(root, rel)
  if (abs !== root && !abs.startsWith(root + sep)) return // never escape the media root
  try {
    await unlink(abs)
  } catch {
    /* already gone — fine */
  }
}

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
 * Live + device control plane, reachable from the dashboard over the compose
 * network (http://ring-worker:<port>); not published to the host.
 *
 *   POST /live/webrtc?device=<id>   body=offer SDP  -> { sdp: answer }   (two-way)
 *   POST /live/keepalive?device=<id>                -> 200
 *   POST /live/start?device=<id>                    -> { path }          (HLS fallback)
 *   POST /live/stop?device=<id>                     -> 200
 *   GET  /device/caps?device=<id>                   -> { hasSiren, hasLight, ... }
 *   POST /device/siren?device=<id>&on=<bool>        -> { siren }
 *   POST /device/light?device=<id>&on=<bool>        -> { light }
 *   POST /events/delete?id=<n>                       -> { deleted }        (local only)
 */
export function startLiveServer(
  port: number,
  cameras: RingCamera[],
  managers: {
    hls: LiveManager
    webrtc: WebRtcManager
    siren?: SirenManager
    repo?: Repository
    mediaRoot?: string
  },
  log: Logger,
): void {
  const byId = new Map(cameras.map((c) => [String(c.id), c]))
  const fallback = cameras[0]
  const { hls, webrtc, siren, repo, mediaRoot } = managers

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

      // Full camera list for the dashboard overview — name + capabilities +
      // last known battery, all from cached device data (no wake / no drain).
      if (req.method === 'GET' && url.pathname === '/devices') {
        return send(
          200,
          cameras.map((c) => ({
            deviceId: String(c.id),
            name: c.name,
            deviceType: c.deviceType,
            hasSiren: c.hasSiren,
            hasLight: c.hasLight,
            hasBattery: c.hasBattery,
            batteryLevel: c.batteryLevel,
            hasLowBattery: c.hasLowBattery,
            operatingOnBattery: c.operatingOnBattery,
          })),
        )
      }

      // Delete one event LOCALLY: remove its clip + thumbnail from the SATA
      // media dir and its row from our SQLite index. This never contacts Ring —
      // it only removes what we recorded on CasaOS.
      if (req.method === 'POST' && url.pathname === '/events/delete') {
        if (!repo || !mediaRoot) return send(503, { error: 'delete not available' })
        const id = Number(url.searchParams.get('id'))
        if (!Number.isInteger(id) || id <= 0) return send(400, { error: 'bad id' })
        const ev = repo.getEventPaths(id)
        if (!ev) return send(404, { error: 'event not found' })
        Promise.all([
          removeMediaFile(mediaRoot, ev.clip_path),
          removeMediaFile(mediaRoot, ev.thumb_path),
        ])
          .then(() => {
            const deleted = repo.deleteEvent(id)
            log.info({ id, deleted }, '🗑 Deleted local event (clip+thumb+row) — Ring untouched')
            send(200, { deleted, id })
          })
          .catch(fail)
        return
      }

      if (!camera) return send(404, { error: 'no camera' })

      // Capability probe — what this physical camera actually supports. The
      // dashboard gates its buttons on this, so a model without a siren/light
      // (e.g. the battery Außenkamera) honestly shows nothing instead of a
      // dead button. GET so it can be fetched cheaply on mount.
      if (req.method === 'GET' && url.pathname === '/device/caps') {
        return send(200, {
          deviceId: id,
          name: camera.name,
          hasSiren: camera.hasSiren,
          hasLight: camera.hasLight,
          hasBattery: camera.hasBattery,
          // Last known battery from cached device data — no wake / no drain.
          batteryLevel: camera.batteryLevel,
          hasLowBattery: camera.hasLowBattery,
          operatingOnBattery: camera.operatingOnBattery,
        })
      }

      if (req.method !== 'POST') return send(404, { error: 'not found' })

      // on=<bool>: default true (turning a control on is the common case).
      const on = url.searchParams.get('on') !== 'false'

      switch (url.pathname) {
        case '/device/siren': {
          if (!camera.hasSiren) return send(409, { error: 'camera has no siren' })
          // on=true also doubles as the keepalive ping (start() is idempotent);
          // the dead-man's switch / hard cap live in the SirenManager.
          const action = siren
            ? on
              ? siren.start(camera)
              : siren.stop(camera)
            : camera.setSiren(on)
          action.then(() => send(200, { siren: on, deviceId: id })).catch(fail)
          return
        }
        case '/device/light':
          if (!camera.hasLight) return send(409, { error: 'camera has no light' })
          log.info({ deviceId: id, on }, on ? '💡 Light ON' : '💡 Light OFF')
          camera
            .setLight(on)
            .then(() => send(200, { light: on, deviceId: id }))
            .catch(fail)
          return
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
