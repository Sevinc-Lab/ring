'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * On-demand live view. Starts the worker's live stream, waits for the HLS
 * playlist to actually exist (battery cams need ~5-10s to wake + ffmpeg must
 * write the first segments), then plays via hls.js (or Safari native HLS).
 * Pings keep-alive while watching; stops on unload. The worker also auto-stops
 * on idle / max duration, so a forgotten tab can't drain the battery.
 */
export default function LivePlayer({ deviceId }: { deviceId: string }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [status, setStatus] = useState('Wecke die Kamera … (kann ~10 Sekunden dauern)')
  const [error, setError] = useState('')

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const q = deviceId ? `?device=${encodeURIComponent(deviceId)}` : ''
    let cancelled = false
    let keepAlive: ReturnType<typeof setInterval> | undefined
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let hls: any

    const stopRemote = () => {
      const url = `/api/live/stop${q}`
      if (navigator.sendBeacon) navigator.sendBeacon(url)
      else fetch(url, { method: 'POST', keepalive: true }).catch(() => {})
    }

    // Poll the playlist until it exists AND lists a segment, or time out.
    async function waitForManifest(url: string, timeoutMs: number): Promise<boolean> {
      const deadline = Date.now() + timeoutMs
      while (!cancelled && Date.now() < deadline) {
        try {
          const r = await fetch(url, { cache: 'no-store' })
          if (r.ok && (await r.text()).includes('.ts')) return true
        } catch {
          /* not ready yet */
        }
        await new Promise((res) => setTimeout(res, 1000))
      }
      return false
    }

    async function begin(video: HTMLVideoElement) {
      let res: Response
      try {
        res = await fetch(`/api/live/start${q}`, { method: 'POST' })
      } catch {
        setError('Worker nicht erreichbar.')
        return
      }
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        setError(e.error ? `Live fehlgeschlagen: ${e.error}` : 'Live konnte nicht gestartet werden.')
        return
      }
      const { path } = await res.json()
      if (cancelled || !path) return
      const url = `/api/media/${path}`

      keepAlive = setInterval(() => {
        fetch(`/api/live/start${q}`, { method: 'POST' }).catch(() => {})
      }, 10000)

      const ready = await waitForManifest(url, 45000)
      if (cancelled) return
      if (!ready) {
        setError('Live-Stream kam nicht zustande (Timeout). Bitte nochmal versuchen.')
        return
      }
      setStatus('')

      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        // Safari / iOS: native HLS
        video.src = url
        video.play().catch(() => {})
        return
      }

      const Hls = (await import('hls.js')).default
      if (cancelled) return
      if (!Hls.isSupported()) {
        setError('Dein Browser unterstützt kein HLS-Video.')
        return
      }
      hls = new Hls({ liveSyncDurationCount: 3, backBufferLength: 10 })
      hls.loadSource(url)
      hls.attachMedia(video)
      hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      hls.on(Hls.Events.ERROR, (_evt: unknown, data: any) => {
        if (!data?.fatal) return
        if (data.type === 'networkError') hls.startLoad()
        else if (data.type === 'mediaError') hls.recoverMediaError()
      })
    }

    void begin(video)
    window.addEventListener('pagehide', stopRemote)

    return () => {
      cancelled = true
      if (keepAlive) clearInterval(keepAlive)
      try {
        hls?.destroy()
      } catch {
        /* ignore */
      }
      window.removeEventListener('pagehide', stopRemote)
      stopRemote()
    }
  }, [deviceId])

  return (
    <div className="liveWrap">
      <div className="player">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video ref={videoRef} controls autoPlay playsInline muted />
      </div>
      {status ? <p className="muted livenote">{status}</p> : null}
      {error ? <p className="liveerr">⚠ {error}</p> : null}
      <p className="muted livenote">
        Live weckt die Akku-Kamera und verbraucht Akku — der Stream stoppt automatisch nach kurzer
        Inaktivität.
      </p>
    </div>
  )
}
