import type { RingCamera } from 'ring-client-api'
import type { Logger } from '../log'

type WebRtcSession = ReturnType<RingCamera['createSimpleWebRtcSession']>

/**
 * Browser two-way live via ring-client-api's SimpleWebRtcSession.
 *
 * The worker only brokers the SDP exchange (and activates the camera speaker);
 * the actual media flows browser <-> Ring directly over WebRTC, so audio codecs
 * are negotiated natively (no manual RTP) and we get real two-way talk + a
 * low-latency picture. Battery-safe: auto-stops on idle / max duration.
 */
interface Live {
  session: WebRtcSession
  startedAt: number
  lastKeepAlive: number
}

export class WebRtcManager {
  private readonly sessions = new Map<string, Live>()

  constructor(
    private readonly maxSeconds: number,
    private readonly idleTimeoutMs: number,
    private readonly log: Logger,
  ) {
    const reaper = setInterval(() => this.reap(), 5000)
    reaper.unref()
  }

  /** Negotiate a new session from the browser's offer SDP; returns the answer SDP. */
  async negotiate(camera: RingCamera, offerSdp: string): Promise<string> {
    const deviceId = String(camera.id)
    await this.stop(deviceId) // only one live session per camera

    this.log.info({ deviceId }, '🔴 Starting WebRTC live (two-way)')
    const session = camera.createSimpleWebRtcSession()
    const answerSdp = await session.start(offerSdp)
    try {
      await session.activateCameraSpeaker()
    } catch (err) {
      this.log.warn({ err, deviceId }, 'activateCameraSpeaker failed (talk may be one-way)')
    }
    this.sessions.set(deviceId, { session, startedAt: Date.now(), lastKeepAlive: Date.now() })
    return answerSdp
  }

  keepAlive(deviceId: string): boolean {
    const s = this.sessions.get(deviceId)
    if (!s) return false
    s.lastKeepAlive = Date.now()
    return true
  }

  async stop(deviceId: string): Promise<void> {
    const s = this.sessions.get(deviceId)
    if (!s) return
    this.sessions.delete(deviceId)
    try {
      await s.session.end()
    } catch {
      /* ignore */
    }
    this.log.info({ deviceId }, '⏹ WebRTC live stopped')
  }

  async stopAll(): Promise<void> {
    for (const id of [...this.sessions.keys()]) await this.stop(id)
  }

  private reap(): void {
    const now = Date.now()
    for (const [id, s] of this.sessions) {
      const tooLong = now - s.startedAt > this.maxSeconds * 1000
      const idle = now - s.lastKeepAlive > this.idleTimeoutMs
      if (tooLong || idle) {
        this.log.info({ deviceId: id, reason: tooLong ? 'max-duration' : 'idle' }, '⏹ Auto-stopping WebRTC live')
        void this.stop(id)
      }
    }
  }
}
