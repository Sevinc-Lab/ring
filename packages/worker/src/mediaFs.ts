import { unlink } from 'fs/promises'
import { resolve, sep } from 'path'

/**
 * Best-effort delete of a media file, constrained to mediaRoot so a stray DB
 * value can never make us unlink outside the media tree. A missing file is
 * fine (already gone). Shared by the manual delete endpoint and the retention
 * sweep.
 */
export async function removeMediaFile(mediaRoot: string, rel: string | null): Promise<void> {
  if (!rel) return
  const root = resolve(mediaRoot)
  const abs = resolve(root, rel)
  if (abs !== root && !abs.startsWith(root + sep)) return // never escape the media root
  try {
    await unlink(abs)
  } catch {
    /* already gone — fine */
  }
}
