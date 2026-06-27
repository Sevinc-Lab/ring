import type { NextRequest } from 'next/server'
import { createReadStream, statSync } from 'fs'
import { Readable } from 'stream'
import { resolveMediaPath, mimeFor } from '@/lib/media'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Serve a media file (mp4 clip or jpg thumbnail) from MEDIA_ROOT.
 * Supports HTTP Range requests so the browser can seek within videos.
 */
export async function GET(req: NextRequest, { params }: { params: { path: string[] } }) {
  const abs = resolveMediaPath(params.path)
  if (!abs) return new Response('Bad path', { status: 400 })

  let size: number
  try {
    const st = statSync(abs)
    if (!st.isFile()) return new Response('Not found', { status: 404 })
    size = st.size
  } catch {
    return new Response('Not found', { status: 404 })
  }

  const baseHeaders: Record<string, string> = {
    'Content-Type': mimeFor(abs),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=60',
  }

  const range = req.headers.get('range')
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
    if (m) {
      let start = m[1] ? parseInt(m[1], 10) : 0
      let end = m[2] ? parseInt(m[2], 10) : size - 1
      if (Number.isNaN(start)) start = 0
      if (Number.isNaN(end) || end >= size) end = size - 1
      if (start > end || start >= size) {
        return new Response('Range Not Satisfiable', {
          status: 416,
          headers: { 'Content-Range': `bytes */${size}` },
        })
      }
      const body = Readable.toWeb(
        createReadStream(abs, { start, end }),
      ) as unknown as ReadableStream
      return new Response(body, {
        status: 206,
        headers: {
          ...baseHeaders,
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Content-Length': String(end - start + 1),
        },
      })
    }
  }

  const body = Readable.toWeb(createReadStream(abs)) as unknown as ReadableStream
  return new Response(body, {
    status: 200,
    headers: { ...baseHeaders, 'Content-Length': String(size) },
  })
}
