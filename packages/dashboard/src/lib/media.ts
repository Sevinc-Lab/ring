import { resolve, sep } from 'path'

/** Media files live here (mounted read-only in compose). */
const MEDIA_ROOT = resolve(process.env.DATA_MEDIA_DIR || '/data/media')

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.ts': 'video/mp2t',
}

/** Live HLS (playlist + segments) must never be cached — they update constantly. */
export function isLivePath(parts: string[]): boolean {
  return parts[0] === 'live' || (parts[parts.length - 1] ?? '').toLowerCase().endsWith('.m3u8')
}

/**
 * Resolve a request path (the `[...path]` segments) to an absolute file inside
 * MEDIA_ROOT, or null if it escapes the root (path traversal) or is malformed.
 */
export function resolveMediaPath(parts: string[]): string | null {
  let rel: string
  try {
    rel = parts.map((p) => decodeURIComponent(p)).join('/')
  } catch {
    return null
  }
  if (rel.includes('\0')) return null
  const abs = resolve(MEDIA_ROOT, rel)
  if (abs !== MEDIA_ROOT && !abs.startsWith(MEDIA_ROOT + sep)) return null
  return abs
}

export function mimeFor(p: string): string {
  const i = p.lastIndexOf('.')
  const ext = i >= 0 ? p.slice(i).toLowerCase() : ''
  return MIME[ext] ?? 'application/octet-stream'
}
