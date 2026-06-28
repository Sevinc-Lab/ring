'use client'

import { useEffect, useRef, useState } from 'react'
import DetectionOverlay from './DetectionOverlay'

/** Resolve once ICE gathering finishes (non-trickle) or after a timeout. */
function waitIceComplete(pc: RTCPeerConnection, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve()
    const done = () => {
      if (pc.iceGatheringState === 'complete') {
        clearTimeout(timer)
        pc.removeEventListener('icegatheringstatechange', done)
        resolve()
      }
    }
    const timer = setTimeout(() => {
      pc.removeEventListener('icegatheringstatechange', done)
      resolve()
    }, timeoutMs)
    pc.addEventListener('icegatheringstatechange', done)
  })
}

/**
 * Two-way live via WebRTC (ring-client-api SimpleWebRtcSession). The browser
 * sends an offer (mic + receive video/audio), the worker brokers the SDP with
 * Ring and activates the camera speaker. Media flows browser <-> Ring directly,
 * so audio codecs negotiate natively. The mic starts muted; the 🎤 button
 * toggles talk. Keep-alive pings keep it up while watching; the worker
 * auto-stops on idle / max duration.
 */
export default function LivePlayer({ deviceId }: { deviceId: string }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const micTrackRef = useRef<MediaStreamTrack | null>(null)
  const [status, setStatus] = useState('Verbinde mit der Kamera … (kann einige Sekunden dauern)')
  const [error, setError] = useState('')
  const [talking, setTalking] = useState(false)
  const [micReady, setMicReady] = useState(false)
  const [detect, setDetect] = useState(false)

  useEffect(() => {
    const q = deviceId ? `?device=${encodeURIComponent(deviceId)}` : ''
    let cancelled = false
    let keepAlive: ReturnType<typeof setInterval> | undefined
    let pc: RTCPeerConnection | undefined

    const stopRemote = () => {
      const url = `/api/live/stop${q}`
      if (navigator.sendBeacon) navigator.sendBeacon(url)
      else fetch(url, { method: 'POST', keepalive: true }).catch(() => {})
    }

    async function begin() {
      pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] })
      pc.addEventListener('track', (e) => {
        if (videoRef.current && e.streams[0]) {
          videoRef.current.srcObject = e.streams[0]
          videoRef.current.play().catch(() => {})
        }
      })
      pc.addEventListener('connectionstatechange', () => {
        if (!pc) return
        if (pc.connectionState === 'connected') setStatus('')
        else if (pc.connectionState === 'failed') setError('WebRTC-Verbindung fehlgeschlagen.')
      })

      // Microphone (for talk). Without it we still watch, just listen-only.
      let micStream: MediaStream | null = null
      try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true })
      } catch {
        micStream = null
      }
      if (cancelled) return
      if (micStream) {
        const track = micStream.getAudioTracks()[0]
        track.enabled = false // muted until the user taps "talk"
        micTrackRef.current = track
        pc.addTrack(track, micStream)
        setMicReady(true)
      } else {
        pc.addTransceiver('audio', { direction: 'recvonly' })
      }
      pc.addTransceiver('video', { direction: 'recvonly' })

      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      await waitIceComplete(pc, 4000)
      if (cancelled) return

      let res: Response
      try {
        res = await fetch(`/api/live/webrtc${q}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/sdp' },
          body: pc.localDescription?.sdp ?? offer.sdp ?? '',
        })
      } catch {
        setError('Worker nicht erreichbar.')
        return
      }
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        setError(e.error ? `Live fehlgeschlagen: ${e.error}` : 'Live konnte nicht gestartet werden.')
        return
      }
      const { sdp } = await res.json()
      if (cancelled) return
      if (!sdp) {
        setError('Keine Antwort von der Kamera.')
        return
      }
      await pc.setRemoteDescription({ type: 'answer', sdp })

      keepAlive = setInterval(() => {
        fetch(`/api/live/keepalive${q}`, { method: 'POST' }).catch(() => {})
      }, 10000)
    }

    void begin().catch((err) => setError(`Fehler: ${err?.message ?? err}`))
    window.addEventListener('pagehide', stopRemote)

    return () => {
      cancelled = true
      if (keepAlive) clearInterval(keepAlive)
      try {
        pc?.getSenders().forEach((s) => s.track?.stop())
        pc?.close()
      } catch {
        /* ignore */
      }
      window.removeEventListener('pagehide', stopRemote)
      stopRemote()
    }
  }, [deviceId])

  const toggleTalk = () => {
    const t = micTrackRef.current
    if (!t) return
    t.enabled = !t.enabled
    setTalking(t.enabled)
  }

  return (
    <div className="liveWrap">
      <div className="player">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video ref={videoRef} controls autoPlay playsInline />
        <DetectionOverlay videoRef={videoRef} enabled={detect} />
      </div>
      {status ? <p className="muted livenote">{status}</p> : null}
      {error ? <p className="liveerr">⚠ {error}</p> : null}

      <div className="talkRow">
        <button
          type="button"
          className={`talkBtn${detect ? ' on' : ''}`}
          onClick={() => setDetect((d) => !d)}
        >
          {detect ? '🔲 Objekt-Erkennung AUS' : '🔲 Objekte erkennen (KI)'}
        </button>
      </div>

      <div className="talkRow">
        <button
          type="button"
          className={`talkBtn${talking ? ' on' : ''}`}
          onClick={toggleTalk}
          disabled={!micReady}
        >
          {talking
            ? '🎤 Mikro AN — sie hören dich (klick zum Stummschalten)'
            : micReady
              ? '🎤 Sprechen (Mikro einschalten)'
              : '🎤 Kein Mikro / nicht erlaubt'}
        </button>
      </div>

      <p className="muted livenote">
        Live + Gegensprechen weckt die Akku-Kamera und verbraucht Akku — stoppt automatisch nach
        kurzer Inaktivität.
      </p>
    </div>
  )
}
