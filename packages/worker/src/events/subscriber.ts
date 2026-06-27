import type { RingCamera } from 'ring-client-api'
import type { Logger } from '../log'
import type { Repository } from '../db/repository'

/**
 * M1 event reception.
 *
 * Primary signal: `camera.onMotionDetected` (boolean Observable). It emits
 * `true` when a motion ding becomes active. This is the most version-stable
 * signal and is exactly what M1-Gate #2 checks: do motion events arrive at all
 * on this 2K camera? (See docs/PLAN.md KORREKTUR 2.)
 *
 * This camera model (Ring Außenkamera Plus Akku, 2K) has no doorbell button,
 * so there is no 'ding' kind — motion only.
 */
export function subscribeCamera(camera: RingCamera, repo: Repository, log: Logger): void {
  const deviceId = String(camera.id)
  const deviceName = camera.name

  camera.onMotionDetected.subscribe((motion: boolean) => {
    if (!motion) return // emits false on subscribe / when motion clears — ignore
    const startedAt = new Date().toISOString()
    log.info({ deviceId, deviceName, startedAt }, '🔔 MOTION event received')
    try {
      const id = repo.insertEvent({
        deviceId,
        deviceName,
        kind: 'motion',
        startedAt,
        recordingStatus: 'event_only', // M1: no clip yet
      })
      if (id === null) {
        log.debug({ deviceId }, 'Duplicate event ignored')
      }
    } catch (err) {
      log.error({ err, deviceId }, 'Failed to persist motion event')
    }
  })

  // Best-effort richer metadata for debugging only (shape varies across versions).
  const anyCam = camera as unknown as {
    onNewNotification?: { subscribe: (cb: (n: unknown) => void) => void }
  }
  if (anyCam.onNewNotification?.subscribe) {
    anyCam.onNewNotification.subscribe((n) => {
      log.debug({ deviceId, notification: n }, 'raw push notification')
    })
  }

  log.info({ deviceId, deviceName }, 'Subscribed to motion events')
}
