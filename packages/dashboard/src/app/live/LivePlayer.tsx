'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * On-demand live view. Starts the worker's live stream, plays the HLS via hls.js
 * (or Safari's native HLS), pings keep-alive while watching, and stops on leave.
 * The worker also auto-stops on idle / max duration, so battery is never drained
 * by a forgotten tab.
 */
export default function LivePlayer({ deviceId }: { deviceId: string }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [status, setStatus] = useState('Wecke die Kamera … (kann einige Sekunden dauern)')
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

      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        // Safari / iOS: native HLS
        video.src = url
        video.play().catch(() => {})
        setStatus('')
      } else {
        const Hls = (await import('hls.js')).default
        if (cancelled) return
        if (!Hls.isSupported()) {
          setError('Dein Browser unterstützt kein HLS-Video.')
          return
        }
        hls = new Hls({
          liveSyncDurationCount: 3,
          manifestLoadingMaxRetry: 30,
          manifestLoadingRetryDelay: 1000,
          levelLoadingMaxRetry: 30,
        })
        hls.loadSource(url)
        hls.attachMedia(video)
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          setStatus('')
          video.play().catch(() => {})
        })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        hls.on(Hls.Events.ERROR, (_evt: unknown, data: any) => {
          if (data?.fatal && data?.type === 'networkError') hls.startLoad()
        })
      }
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
