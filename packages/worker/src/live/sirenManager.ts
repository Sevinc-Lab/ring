import type { RingCamera } from 'ring-client-api'
import type { Logger } from '../log'

interface Active {
  camera: RingCamera
  startedAt: number
  lastKeepAlive: number
}

/**
 * Siren with a dead-man's switch. Three independent nets turn it off, whichever
 * comes first:
 *   1. manual   — stop() when the user taps the off button
 *   2. keepalive — the controlling browser pings while the siren is on; if the
 *      pings stop (device unreachable / tab closed) we auto-off after `graceMs`
 *   3. hard cap  — auto-off after `maxMs` no matter what, so a forgotten tab
 *      that keeps pinging can never make it wail forever
 *
 * start() is idempotent: re-calling it for an already-active siren just bumps
 * the keepalive (so the browser can use it as the ping), and never re-issues
 * setSiren(true) to Ring.
 */
export class SirenManager {
  private readonly active = new Map<string, Active>()

  constructor(
    private readonly graceMs: number,
    private readonly maxMs: number,
    private readonly log: Logger,
  ) {
    const reaper = setInterval(() => this.reap(), 2000)
    reaper.unref()
  }

  /** Turn the siren on (or, if already on, bump its keepalive). */
  async start(camera: RingCamera): Promise<void> {
    const id = String(camera.id)
    const now = Date.now()
    const existing = this.active.get(id)
    if (existing) {
      existing.lastKeepAlive = now
      return
    }
    this.active.set(id, { camera, startedAt: now, lastKeepAlive: now })
    this.log.info(
      { deviceId: id, graceMs: this.graceMs, maxMs: this.maxMs },
      '🚨 Siren ON (auto-off armed)',
    )
    await camera.setSiren(true)
  }

  keepAlive(deviceId: string): boolean {
    const a = this.active.get(deviceId)
    if (!a) return false
    a.lastKeepAlive = Date.now()
    return true
  }

  /** Manual off. */
  async stop(camera: RingCamera): Promise<void> {
    const id = String(camera.id)
    this.active.delete(id)
    this.log.info({ deviceId: id, reason: 'manual' }, '🔕 Siren OFF')
    await camera.setSiren(false)
  }

  private reap(): void {
    const now = Date.now()
    for (const [id, a] of this.active) {
      const tooLong = now - a.startedAt > this.maxMs
      const unreachable = now - a.lastKeepAlive > this.graceMs
      if (tooLong || unreachable) {
        this.active.delete(id)
        const reason = tooLong ? 'max-duration' : 'device-unreachable'
        this.log.info({ deviceId: id, reason }, '🔕 Siren auto-OFF')
        void a.camera
          .setSiren(false)
          .catch((err) => this.log.warn({ err, deviceId: id }, 'siren auto-off failed'))
      }
    }
  }

  /** Best-effort: turn every active siren off (shutdown). */
  async stopAll(): Promise<void> {
    const cams = [...this.active.values()].map((a) => a.camera)
    this.active.clear()
    for (const camera of cams) {
      try {
        await camera.setSiren(false)
      } catch {
        /* ignore */
      }
    }
  }
}
