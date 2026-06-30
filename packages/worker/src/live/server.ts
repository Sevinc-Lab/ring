import { createServer, type IncomingMessage } from 'http'
import { mkdir, writeFile } from 'fs/promises'
import type { RingCamera } from 'ring-client-api'
import type { Logger } from '../log'
import type { LiveManager } from './liveManager'
import type { WebRtcManager } from './webrtcManager'
import type { SirenManager } from './sirenManager'
import type { Repository } from '../db/repository'
import { removeMediaFile } from '../mediaFs'
import { buildClipPaths } from '../recorder/paths'
import { extractFirstFrame } from '../recorder/thumbnail'

/** Collect a binary request body (live recording upload) up to `limit` bytes. */
function readBinary(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > limit) {
        reject(new Error('recording too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

/**
 * Battery info for the dashboard. ring-client-api's `camera.batteryLevel`
 * returns Math.min(battery_life, battery_life_2) — which is wrong for
 * dual-battery cameras (e.g. cocoa_camera_v2): they drain ONE battery at a
 * time, so the min is the near-empty spare while the device happily runs on the
 * full one (the Ring app shows the full/active one). We report the ACTIVE
 * (higher) battery as the headline, plus every present level for the tooltip.
 */
function batteryInfo(camera: RingCamera): {
  hasBattery: boolean
  batteryLevel: number | null
  batteryLevels: number[]
  hasLowBattery: boolean
  operatingOnBattery: boolean
} {
  const d = camera.data as {
    battery_life?: number | string | null
    battery_life_2?: number | string | null
  }
  const parse = (v: number | string | null | undefined): number | null => {
    if (v === null || v === undefined) return null
    const n = typeof v === 'number' ? v : Number.parseFloat(v)
    return Number.isNaN(n) ? null : n
  }
  const levels = [parse(d?.battery_life), parse(d?.battery_life_2)].filter(
    (n): n is number => n !== null,
  )
  return {
    hasBattery: camera.hasBattery,
    batteryLevel: levels.length ? Math.max(...levels) : camera.batteryLevel,
    batteryLevels: levels,
    hasLowBattery: camera.hasLowBattery,
    operatingOnBattery: camera.operatingOnBattery,
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
 *   POST /events/relabel?ids=1,2 | ?all=1            -> { queued }         (re-detect)
 *   POST /live/record?device=<id>&seconds=<n>  body=webm -> { id }         (save live clip)
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
            ...batteryInfo(c),
          })),
        )
      }

      // Delete one event LOCALLY: remove its clip + thumbnail from the SATA
      // media dir and its row from our SQLite index. This never contacts Ring —
      // it only removes what we recorded on CasaOS.
      if (req.method === 'POST' && url.pathname === '/events/delete') {
        if (!repo || !mediaRoot) return send(503, { error: 'delete not available' })
        const repoRef = repo
        const rootRef = mediaRoot
        // Accept ?id=<n> (single) or ?ids=1,2,3 (bulk).
        const raw = url.searchParams.get('ids') ?? url.searchParams.get('id') ?? ''
        const ids = [...new Set(raw.split(',').map((s) => Number(s.trim())))].filter(
          (n) => Number.isInteger(n) && n > 0,
        )
        if (ids.length === 0) return send(400, { error: 'no valid id(s)' })
        ;(async () => {
          let deleted = 0
          for (const id of ids) {
            const ev = repoRef.getEventPaths(id)
            if (!ev) continue
            await removeMediaFile(rootRef, ev.clip_path)
            await removeMediaFile(rootRef, ev.thumb_path)
            if (repoRef.deleteEvent(id)) deleted++
          }
          log.info({ requested: ids.length, deleted }, '🗑 Deleted local events — Ring untouched')
          send(200, { deleted, requested: ids.length })
        })().catch(fail)
        return
      }

      // Re-detect: reset events to 'unclassified' so the detector reprocesses
      // them with the current model. ?all=1 for every recorded clip, or ?ids=.
      if (req.method === 'POST' && url.pathname === '/events/relabel') {
        if (!repo) return send(503, { error: 'relabel not available' })
        const all = url.searchParams.get('all') === '1'
        if (all) {
          const queued = repo.requeueForRelabel()
          log.info({ queued }, '🔄 Re-queued all clips for detection')
          return send(200, { queued })
        }
        const raw = url.searchParams.get('ids') ?? url.searchParams.get('id') ?? ''
        const ids = [...new Set(raw.split(',').map((s) => Number(s.trim())))].filter(
          (n) => Number.isInteger(n) && n > 0,
        )
        if (ids.length === 0) return send(400, { error: 'no valid id(s)' })
        const queued = repo.requeueForRelabel(ids)
        log.info({ queued, ids: ids.length }, '🔄 Re-queued clips for detection')
        return send(200, { queued })
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
          // Battery from cached/polled device data — no wake / no drain. The
          // headline is the ACTIVE (higher) of two batteries; see batteryInfo.
          ...batteryInfo(camera),
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
        case '/live/record': {
          // The browser recorded the live WebRTC stream and uploads the webm
          // here; we save it as a normal event so it appears in the Verlauf.
          if (!repo || !mediaRoot) return send(503, { error: 'recording not available' })
          const repoRef = repo
          const rootRef = mediaRoot
          const seconds = Number(url.searchParams.get('seconds')) || null
          readBinary(req, 300_000_000)
            .then(async (buf) => {
              if (buf.length < 1024) return send(400, { error: 'empty recording' })
              const whenMs = Date.now()
              const p = buildClipPaths(rootRef, id, 'live', whenMs, 'webm')
              await mkdir(p.dirAbs, { recursive: true })
              await writeFile(p.clipAbs, buf)
              const thumb = await extractFirstFrame(p.clipAbs, p.thumbAbs, log)
              const evId = repoRef.insertEvent({
                deviceId: id,
                deviceName: camera.name,
                kind: 'live',
                startedAt: new Date(whenMs).toISOString(),
                recordingStatus: 'recorded',
              })
              if (evId != null) {
                repoRef.updateRecording(evId, {
                  recordingStatus: 'recorded',
                  clipPath: p.clipRel,
                  thumbPath: thumb ? p.thumbRel : null,
                  clipSeconds: seconds,
                })
              }
              log.info({ deviceId: id, bytes: buf.length, evId }, '⏺ Saved live recording')
              send(200, { ok: true, id: evId })
            })
            .catch(fail)
          return
        }
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
