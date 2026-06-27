import { spawn } from 'child_process'
import type { Logger } from '../log'

/**
 * Extract a thumbnail from the FIRST FRAME of a recorded clip via ffmpeg.
 *
 * KORREKTUR 1: battery cameras cannot take a snapshot while recording, and every
 * motion event starts a recording — so the thumbnail MUST come from the clip's
 * first frame, never from getSnapshot().
 *
 * Best-effort: if ffmpeg is missing or fails, we resolve `false` (no thumbnail)
 * and the caller keeps the clip + row anyway — nothing is deleted.
 */
export function extractFirstFrame(
  clipPath: string,
  thumbPath: string,
  log: Logger,
): Promise<boolean> {
  return new Promise((resolve) => {
    const ff = spawn('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-i',
      clipPath,
      '-frames:v',
      '1',
      '-q:v',
      '2',
      thumbPath,
    ])

    let stderr = ''
    ff.stderr.on('data', (d) => {
      stderr += d.toString()
    })
    ff.on('error', (err) => {
      log.warn({ err }, 'ffmpeg spawn failed — clip kept, no thumbnail')
      resolve(false)
    })
    ff.on('close', (code) => {
      if (code === 0) {
        resolve(true)
      } else {
        log.warn(
          { code, stderr: stderr.slice(0, 500) },
          'ffmpeg thumbnail failed — clip kept, no thumbnail',
        )
        resolve(false)
      }
    })
  })
}
