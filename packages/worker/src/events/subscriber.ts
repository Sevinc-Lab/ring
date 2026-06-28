import type { RingCamera } from 'ring-client-api'
import type { Logger } from '../log'
import type { Repository } from '../db/repository'
import { recordClip } from '../recorder/recorder'
import { buildClipPaths } from '../recorder/paths'

export interface MotionContext {
  repo: Repository
  mediaRoot: string
  clipSeconds: number
  log: Logger
  /** Optional webhook fired the instant a doorbell is pressed (best-effort). */
  dingWebhookUrl?: string
}

/** Best-effort "es klingelt" webhook (e.g. n8n → Telegram). Never throws. */
function notifyDing(ctx: MotionContext, deviceName: string, startedAt: string): void {
  const url = ctx.dingWebhookUrl
  if (!url) return
  void fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'ding',
      title: '🔔🔔 ES KLINGELT',
      device: deviceName,
      started_at: startedAt,
    }),
  }).catch((err) => ctx.log.warn({ err }, 'ding webhook failed (ignored)'))
}

/**
 * M2 event reception + recording.
 *
 * Primary signal: `camera.onMotionDetected` (boolean Observable), emitting `true`
 * when a motion ding becomes active. This camera model (Ring Außenkamera Plus
 * Akku, 2K) has no doorbell button → motion only, no 'ding'.
 *
 * On each motion event we insert a row, then wake the live stream and record a
 * clip (recordToFile), derive a first-frame thumbnail (KORREKTUR 1), and update
 * the row. Failures keep the row (`failed`) — nothing is deleted.
 *
 * Concurrency: at most ONE recording per camera at a time (battery-friendly).
 * A motion event that arrives while a recording is in flight is still logged as
 * a row (`event_only`) but is not recorded in parallel.
 */
export function subscribeCamera(camera: RingCamera, ctx: MotionContext): void {
  const deviceId = String(camera.id)
  const deviceName = camera.name
  const { repo, log } = ctx
  let recording = false

  camera.onMotionDetected.subscribe((motion: boolean) => {
    if (!motion) return // emits false on subscribe / when motion clears — ignore

    const startedAt = new Date().toISOString()
    const whenMs = Date.now()
    log.info({ deviceId, deviceName, startedAt }, '🔔 MOTION event received')

    if (recording) {
      // Overlap: log the event but do not start a second concurrent recording.
      repo.insertEvent({
        deviceId,
        deviceName,
        kind: 'motion',
        startedAt,
        recordingStatus: 'event_only',
      })
      log.info({ deviceId }, 'Motion during active recording — logged, not recorded (battery-safe)')
      return
    }

    const rowId = repo.insertEvent({
      deviceId,
      deviceName,
      kind: 'motion',
      startedAt,
      recordingStatus: 'pending',
    })
    if (rowId === null) {
      log.debug({ deviceId }, 'Duplicate event ignored')
      return
    }

    recording = true
    void recordEvent(camera, ctx, rowId, whenMs, 'motion').finally(() => {
      recording = false
    })
  })

  // Doorbell press ('ding'). Only doorbells emit this. We ALWAYS log the press
  // immediately (so the dashboard can ring instantly) + fire the optional
  // webhook, then record a clip if the camera isn't already recording.
  const pressed = (camera as unknown as { onDoorbellPressed?: { subscribe: (cb: () => void) => void } })
    .onDoorbellPressed
  if (camera.isDoorbot && typeof pressed?.subscribe === 'function') {
    pressed.subscribe(() => {
      const startedAt = new Date().toISOString()
      const whenMs = Date.now()
      log.info({ deviceId, deviceName, startedAt }, '🔔🔔 DOORBELL pressed')
      notifyDing(ctx, deviceName, startedAt)
      const rowId = repo.insertEvent({
        deviceId,
        deviceName,
        kind: 'ding',
        startedAt,
        recordingStatus: recording ? 'event_only' : 'pending',
      })
      if (rowId !== null && !recording) {
        recording = true
        void recordEvent(camera, ctx, rowId, whenMs, 'ding').finally(() => {
          recording = false
        })
      }
    })
    log.info({ deviceId, deviceName }, 'Subscribed to doorbell-press events')
  }

  // Best-effort richer metadata for debugging only.
  //
  // NOTE: `onNewNotification` is accessed through an `any`-style cast on purpose.
  // Its payload shape is NOT stable — it varies across ring-client-api versions
  // (and was renamed from `onNewDing` historically). We therefore do not rely on
  // any field here: the value is only logged at debug level, never parsed or used
  // to drive behaviour. If a future milestone needs fields off this payload,
  // validate them at runtime (e.g. with zod) rather than trusting the type.
  const anyCam = camera as unknown as {
    onNewNotification?: { subscribe: (cb: (n: unknown) => void) => void }
  }
  if (typeof anyCam.onNewNotification?.subscribe === 'function') {
    anyCam.onNewNotification.subscribe((n) => {
      log.debug({ deviceId, notification: n }, 'raw push notification (shape is version-dependent)')
    })
  }

  log.info({ deviceId, deviceName }, 'Subscribed to motion events')
}

async function recordEvent(
  camera: RingCamera,
  ctx: MotionContext,
  rowId: number,
  whenMs: number,
  kind: string,
): Promise<void> {
  const { repo, mediaRoot, clipSeconds, log } = ctx
  const paths = buildClipPaths(mediaRoot, String(camera.id), kind, whenMs)

  try {
    const result = await recordClip(camera, paths, clipSeconds, log)
    repo.updateRecording(rowId, {
      recordingStatus: 'recorded',
      clipPath: paths.clipRel,
      thumbPath: result.thumbCreated ? paths.thumbRel : null,
      clipSeconds,
      coldStartMs: result.coldStartMs ?? null,
    })
    log.info(
      {
        rowId,
        clip: paths.clipRel,
        bytes: result.bytes,
        coldStartMs: result.coldStartMs,
        thumb: result.thumbCreated,
      },
      '🎥 Clip recorded',
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    repo.updateRecording(rowId, { recordingStatus: 'failed', error: message })
    log.error({ err, rowId }, 'Recording failed — row kept (nothing deleted)')
  }
}
