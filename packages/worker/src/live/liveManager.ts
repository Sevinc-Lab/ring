import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import type { RingCamera } from 'ring-client-api'
import type { Logger } from '../log'

// StreamingSession isn't re-exported from the package entry — derive it.
type StreamSession = Awaited<ReturnType<RingCamera['streamVideo']>>

/**
 * On-demand live view for a battery camera.
 *
 * A live session wakes the camera (streamVideo) and pipes it to ffmpeg as HLS
 * segments under <mediaRoot>/live/<deviceId>/, which the dashboard serves and
 * plays in the browser. Sessions auto-stop on idle (no keep-alive) or after a
 * hard max duration so the battery is never drained by a forgotten stream.
 *
 * This is explicitly NOT continuous streaming — it only runs while a viewer is
 * actively watching (the dashboard pings keepAlive), respecting the
 * battery/event-driven design.
 */
interface LiveSession {
  deviceId: string
  session: StreamSession
  absDir: string
  relPath: string
  startedAt: number
  lastKeepAlive: number
}

export class LiveManager {
  private readonly sessions = new Map<string, LiveSession>()

  constructor(
    private readonly mediaRoot: string,
    private readonly maxSeconds: number,
    private readonly idleTimeoutMs: number,
    private readonly log: Logger,
  ) {
    const reaper = setInterval(() => this.reap(), 5000)
    reaper.unref()
  }

  /** Start (or keep-alive) a live session. Returns the relative HLS path. */
  async start(camera: RingCamera): Promise<string> {
    const deviceId = String(camera.id)
    const existing = this.sessions.get(deviceId)
    if (existing) {
      existing.lastKeepAlive = Date.now()
      return existing.relPath
    }

    const relDir = join('live', deviceId)
    const absDir = join(this.mediaRoot, relDir)
    rmSync(absDir, { recursive: true, force: true })
    mkdirSync(absDir, { recursive: true })

    const m3u8Abs = join(absDir, 'stream.m3u8')
    const segAbs = join(absDir, 'seg_%03d.ts')
    const relPath = join(relDir, 'stream.m3u8')

    this.log.info({ deviceId }, '🔴 Starting live stream (on-demand)')
    const session = await camera.streamVideo({
      output: [
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-f', 'hls',
        '-hls_time', '2',
        '-hls_list_size', '5',
        '-hls_flags', 'delete_segments+omit_endlist',
        '-hls_segment_filename', segAbs,
        m3u8Abs,
      ],
    })

    const live: LiveSession = {
      deviceId,
      session,
      absDir,
      relPath,
      startedAt: Date.now(),
      lastKeepAlive: Date.now(),
    }
    session.onCallEnded.subscribe(() => {
      this.sessions.delete(deviceId)
      rmSync(absDir, { recursive: true, force: true })
    })
    this.sessions.set(deviceId, live)
    return relPath
  }

  keepAlive(deviceId: string): boolean {
    const s = this.sessions.get(deviceId)
    if (!s) return false
    s.lastKeepAlive = Date.now()
    return true
  }

  stop(deviceId: string): void {
    const s = this.sessions.get(deviceId)
    if (!s) return
    this.sessions.delete(deviceId)
    try {
      s.session.stop()
    } catch {
      /* ignore */
    }
    rmSync(s.absDir, { recursive: true, force: true })
    this.log.info({ deviceId }, '⏹ Live stream stopped')
  }

  stopAll(): void {
    for (const id of [...this.sessions.keys()]) this.stop(id)
  }

  private reap(): void {
    const now = Date.now()
    for (const [id, s] of this.sessions) {
      const tooLong = now - s.startedAt > this.maxSeconds * 1000
      const idle = now - s.lastKeepAlive > this.idleTimeoutMs
      if (tooLong || idle) {
        this.log.info({ deviceId: id, reason: tooLong ? 'max-duration' : 'idle' }, '⏹ Auto-stopping live')
        this.stop(id)
      }
    }
  }
}
