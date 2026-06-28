import { join } from 'path'

/**
 * Media path layout (relative to DATA_MEDIA_DIR):
 *   <device_id>/<YYYY-MM-DD>/<epochMs>_<kind>.<ext>
 *
 * Paths stored in SQLite are RELATIVE to the media root, so the volume can be
 * remounted/moved without breaking references (see docs/PLAN.md §6).
 */
export interface ClipPaths {
  /** absolute path for ffmpeg/recordToFile output */
  clipAbs: string
  /** absolute path for the first-frame thumbnail */
  thumbAbs: string
  /** relative path stored in DB */
  clipRel: string
  /** relative path stored in DB */
  thumbRel: string
  /** directory that must exist before writing */
  dirAbs: string
}

export function buildClipPaths(
  mediaRoot: string,
  deviceId: string,
  kind: string,
  whenMs: number,
  ext = 'mp4',
): ClipPaths {
  const day = new Date(whenMs).toISOString().slice(0, 10) // YYYY-MM-DD (UTC)
  const base = `${whenMs}_${kind}`
  const relDir = join(deviceId, day)
  const clipRel = join(relDir, `${base}.${ext}`)
  const thumbRel = join(relDir, `${base}.jpg`)
  return {
    dirAbs: join(mediaRoot, relDir),
    clipAbs: join(mediaRoot, clipRel),
    thumbAbs: join(mediaRoot, thumbRel),
    clipRel,
    thumbRel,
  }
}
