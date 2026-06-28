import type { NextRequest } from 'next/server'
import { createReadStream, statSync } from 'fs'
import type { ReadStream } from 'fs'
import { resolveMediaPath, mimeFor, isLivePath } from '@/lib/media'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Wrap a Node read stream as a web ReadableStream with correct lifecycle:
 * - client disconnect / seek (cancel) destroys the file stream
 * - backpressure via pause/resume so we don't buffer the whole file
 * - enqueue-after-close is guarded (the browser aborting a Range request mid-
 *   flight must not throw "Controller is already closed")
 *
 * <video> elements and lazy-loaded thumbnails abort requests constantly, so
 * this must be robust.
 */
function toWebStream(nodeStream: ReadStream): ReadableStream<Uint8Array> {
  let done = false
  const finish = () => {
    if (done) return
    done = true
    nodeStream.destroy()
  }
  return new ReadableStream<Uint8Array>({
    start(controller) {
      nodeStream.on('data', (chunk: string | Buffer) => {
        if (done) return
        const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
        try {
          controller.enqueue(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength))
        } catch {
          finish() // controller already closed (client went away)
          return
        }
        if (controller.desiredSize !== null && controller.desiredSize <= 0) {
          nodeStream.pause()
        }
      })
      nodeStream.on('end', () => {
        if (done) return
        done = true
        try {
          controller.close()
        } catch {
          /* already closed */
        }
      })
      nodeStream.on('error', (err) => {
        if (done) return
        done = true
        try {
          controller.error(err)
        } catch {
          /* already closed */
        }
      })
    },
    pull() {
      nodeStream.resume()
    },
    cancel() {
      finish()
    },
  })
}

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
    'Cache-Control': isLivePath(params.path) ? 'no-store' : 'private, max-age=60',
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
      return new Response(toWebStream(createReadStream(abs, { start, end })), {
        status: 206,
        headers: {
          ...baseHeaders,
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Content-Length': String(end - start + 1),
        },
      })
    }
  }

  return new Response(toWebStream(createReadStream(abs)), {
    status: 200,
    headers: { ...baseHeaders, 'Content-Length': String(size) },
  })
}
