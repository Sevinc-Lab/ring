'use client'

import { useEffect, useRef, useState, type RefObject } from 'react'
import type { Box } from '@/lib/yolo'

/**
 * Draws YOLOv8n bounding boxes over the live <video>. Inference runs in the
 * browser (onnxruntime-web) on the viewer's device, throttled to a few FPS. The
 * canvas overlays the video 1:1 (sized to the video's intrinsic pixels) and is
 * click-through so the player controls still work.
 */
export default function DetectionOverlay({
  videoRef,
  enabled,
}: {
  videoRef: RefObject<HTMLVideoElement>
  enabled: boolean
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [status, setStatus] = useState('')

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d') ?? null
    if (!canvas || !ctx) return
    if (!enabled) {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      setStatus('')
      return
    }

    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    setStatus('KI-Modell lädt … (einmalig ~12 MB)')

    void (async () => {
      let yolo: typeof import('@/lib/yolo')
      try {
        yolo = await import('@/lib/yolo')
        await yolo.loadModel()
      } catch {
        if (!stopped) setStatus('KI-Modell konnte nicht geladen werden.')
        return
      }
      if (stopped) return
      setStatus('')

      const loop = async () => {
        if (stopped) return
        const v = videoRef.current
        const t0 = performance.now()
        if (v && v.videoWidth) {
          try {
            const boxes = await yolo.detect(v)
            if (!stopped) draw(canvas, ctx, v, boxes)
          } catch {
            /* transient frame error — keep going */
          }
        }
        const elapsed = performance.now() - t0
        timer = setTimeout(() => void loop(), Math.max(0, 200 - elapsed))
      }
      void loop()
    })()

    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
    }
  }, [enabled, videoRef])

  return (
    <>
      <canvas ref={canvasRef} className="detCanvas" />
      {status ? <span className="detStatus">{status}</span> : null}
    </>
  )
}

function draw(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  boxes: Box[],
): void {
  if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth
  if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  const fs = Math.max(13, Math.round(canvas.width / 48))
  ctx.lineWidth = Math.max(2, canvas.width / 400)
  ctx.font = `600 ${fs}px system-ui, sans-serif`
  ctx.textBaseline = 'top'
  for (const b of boxes) {
    const col = b.primary ? '#6c8cff' : '#7ce38b'
    ctx.strokeStyle = col
    ctx.strokeRect(b.x1, b.y1, b.x2 - b.x1, b.y2 - b.y1)
    const label = `${b.name} ${Math.round(b.conf * 100)}%`
    const tw = ctx.measureText(label).width
    const th = fs * 1.3
    const ly = Math.max(0, b.y1 - th)
    ctx.fillStyle = col
    ctx.fillRect(b.x1, ly, tw + 8, th)
    ctx.fillStyle = '#0b0d11'
    ctx.fillText(label, b.x1 + 4, ly + 2)
  }
}
