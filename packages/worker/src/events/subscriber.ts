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
  /** Optional generic webhook fired on doorbell press (e.g. n8n → Telegram). */
  dingWebhookUrl?: string
  /** Optional ntfy topic URL for a loud "incoming call" alarm on the phone. */
  ntfyUrl?: string
  /** Dashboard base URL (e.g. the Tailscale https URL) for tap-to-answer links. */
  dashboardBaseUrl?: string
}

const trimSlash = (s: string) => s.replace(/\/+$/, '')

/** Tap-to-answer deep link: opens the camera's live view with the mic on. */
function answerLink(ctx: MotionContext, deviceId: string): string | undefined {
  return ctx.dashboardBaseUrl
    ? `${trimSlash(ctx.dashboardBaseUrl)}/live?device=${encodeURIComponent(deviceId)}&talk=1`
    : undefined
}

function mediaLink(ctx: MotionContext, rel: string): string | undefined {
  return ctx.dashboardBaseUrl ? `${trimSlash(ctx.dashboardBaseUrl)}/api/media/${rel}` : undefined
}

/** Best-effort generic webhook (n8n → Telegram). Includes a tap-to-answer link. */
function notifyDingWebhook(
  ctx: MotionContext,
  deviceName: string,
  startedAt: string,
  answerUrl?: string,
  eventUrl?: string,
): void {
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
      answer_url: answerUrl ?? null,
      event_url: eventUrl ?? null,
    }),
  }).catch((err) => ctx.log.warn({ err }, 'ding webhook failed (ignored)'))
}

/**
 * Best-effort ntfy push (self-hosted). priority "urgent" makes the phone ring
 * loudly even when locked; an "Annehmen" action + click open the live view;
 * `attach` shows an image. Header values stay ASCII (ntfy headers are latin-1);
 * the UTF-8 message goes in the body.
 */
function notifyNtfy(
  ctx: MotionContext,
  opts: { message: string; priority: string; click?: string; attach?: string },
): void {
  const url = ctx.ntfyUrl
  if (!url) return
  const headers: Record<string, string> = {
    Title: 'Es klingelt',
    Priority: opts.priority,
    Tags: 'bell',
  }
  if (opts.click) {
    headers.Click = opts.click
    headers.Actions = `view, Annehmen, ${opts.click}`
  }
  if (opts.attach) headers.Attach = opts.attach
  void fetch(url, { method: 'POST', headers, body: opts.message }).catch((err) =>
    ctx.log.warn({ err }, 'ntfy push failed (ignored)'),
  )
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
      const rowId = repo.insertEvent({
        deviceId,
        deviceName,
        kind: 'ding',
        startedAt,
        recordingStatus: recording ? 'event_only' : 'pending',
      })
      // Alarm immediately (don't wait for the recording): Telegram + a loud ntfy
      // "call" with a tap-to-answer link. The image follows once the first frame
      // is recorded (see recordEvent).
      const answerUrl = answerLink(ctx, deviceId)
      const eventUrl =
        ctx.dashboardBaseUrl && rowId !== null
          ? `${trimSlash(ctx.dashboardBaseUrl)}/event/${rowId}`
          : undefined
      notifyDingWebhook(ctx, deviceName, startedAt, answerUrl, eventUrl)
      notifyNtfy(ctx, {
        message: `🔔 Jemand klingelt an der Tür (${deviceName})`,
        priority: 'urgent',
        click: answerUrl,
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
    // For a doorbell press, follow up with the captured image once it exists.
    if (kind === 'ding' && result.thumbCreated) {
      notifyNtfy(ctx, {
        message: `📷 Bild von der Tür (${camera.name})`,
        priority: 'high',
        click: answerLink(ctx, String(camera.id)),
        attach: mediaLink(ctx, paths.thumbRel),
      })
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    repo.updateRecording(rowId, { recordingStatus: 'failed', error: message })
    log.error({ err, rowId }, 'Recording failed — row kept (nothing deleted)')
  }
}
