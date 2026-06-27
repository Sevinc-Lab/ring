import { promises as fs } from 'fs'
import type { RingCamera } from 'ring-client-api'
import type { Logger } from '../log'
import { extractFirstFrame } from './thumbnail'
import type { ClipPaths } from './paths'

/** Bytes the clip must reach before we treat it as "first frame arrived". */
const FIRST_FRAME_BYTES = 1024
/** How often to poll the growing clip file for the cold-start measurement. */
const POLL_MS = 250

export interface RecordResult {
  /** Event → first frame written, in ms (undefined if the file never grew). */
  coldStartMs?: number
  /** Whether a first-frame thumbnail was produced. */
  thumbCreated: boolean
  /** Final clip size in bytes. */
  bytes: number
}

/**
 * Record one motion clip and derive its thumbnail.
 *
 * recordToFile() resolves only when the live call ends (after `clipSeconds`), so
 * to approximate the cold-start latency (event → first frame) we poll the output
 * file while it records and capture the moment it first holds real data.
 *
 * Throws if the clip is empty/too small (e.g. the stream never woke up) — the
 * caller marks the row `failed` and keeps it; nothing is deleted.
 */
export async function recordClip(
  camera: RingCamera,
  paths: ClipPaths,
  clipSeconds: number,
  log: Logger,
): Promise<RecordResult> {
  await fs.mkdir(paths.dirAbs, { recursive: true })

  const t0 = Date.now()
  let coldStartMs: number | undefined

  const poll = setInterval(() => {
    if (coldStartMs !== undefined) return
    void fs
      .stat(paths.clipAbs)
      .then((st) => {
        if (coldStartMs === undefined && st.size > FIRST_FRAME_BYTES) {
          coldStartMs = Date.now() - t0
        }
      })
      .catch(() => {
        /* file not created yet */
      })
  }, POLL_MS)

  try {
    log.info(
      { device: camera.id, clipSeconds, path: paths.clipRel },
      'Waking live stream and recording clip',
    )
    await camera.recordToFile(paths.clipAbs, clipSeconds)
  } finally {
    clearInterval(poll)
  }

  const st = await fs.stat(paths.clipAbs).catch(() => null)
  if (!st || st.size < FIRST_FRAME_BYTES) {
    throw new Error(
      `clip empty or too small (${st ? st.size : 'missing'} bytes) — stream likely never woke up`,
    )
  }

  const thumbCreated = await extractFirstFrame(paths.clipAbs, paths.thumbAbs, log)
  return { coldStartMs, thumbCreated, bytes: st.size }
}
