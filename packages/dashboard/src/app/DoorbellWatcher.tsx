'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

interface Ding {
  id: number
  deviceId: string
  deviceName: string | null
  startedAt: string
}

/**
 * Polls the worker's DB (via /api/notify/recent) for a doorbell press and, when
 * a fresh one arrives, shows a full-screen "incoming call" overlay with a
 * looping ring tone + vibration. Answer → live view with hands-free talk.
 *
 * Caveat: this only rings on an OPEN dashboard/PWA — a true call-style ring with
 * the app closed needs a native app. The Telegram push covers the closed case.
 */
export default function DoorbellWatcher() {
  const router = useRouter()
  const [ding, setDing] = useState<Ding | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const ringTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Prime the AudioContext on the first user gesture so the ring can play later
  // (browsers block audio without a prior interaction).
  useEffect(() => {
    const unlock = () => {
      try {
        const Ctx =
          window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (Ctx && !audioCtxRef.current) audioCtxRef.current = new Ctx()
        void audioCtxRef.current?.resume()
      } catch {
        /* ignore */
      }
    }
    window.addEventListener('pointerdown', unlock, { once: true })
    return () => window.removeEventListener('pointerdown', unlock)
  }, [])

  // Poll for a fresh ding; ignore ones already handled (persisted across reloads).
  useEffect(() => {
    let stopped = false
    const tick = async () => {
      try {
        const r = await fetch('/api/notify/recent', { cache: 'no-store' })
        if (!r.ok) return
        const { ding: d } = (await r.json()) as { ding: Ding | null }
        if (stopped || !d) return
        const last = Number(localStorage.getItem('lastDingId') || '0')
        if (d.id > last) {
          localStorage.setItem('lastDingId', String(d.id))
          setDing(d)
        }
      } catch {
        /* worker unreachable — try again next tick */
      }
    }
    void tick()
    const t = setInterval(tick, 3000)
    return () => {
      stopped = true
      clearInterval(t)
    }
  }, [])

  // Ring + vibrate while the overlay is up.
  useEffect(() => {
    if (!ding) return
    const ctx = audioCtxRef.current
    const ringOnce = () => {
      if (!ctx || ctx.state !== 'running') return
      const t = ctx.currentTime
      const beep = (freq: number, start: number, dur: number) => {
        const o = ctx.createOscillator()
        const g = ctx.createGain()
        o.type = 'sine'
        o.frequency.value = freq
        o.connect(g)
        g.connect(ctx.destination)
        g.gain.setValueAtTime(0.0001, start)
        g.gain.exponentialRampToValueAtTime(0.35, start + 0.02)
        g.gain.exponentialRampToValueAtTime(0.0001, start + dur)
        o.start(start)
        o.stop(start + dur)
      }
      beep(880, t, 0.4) // ding
      beep(660, t + 0.5, 0.6) // dong
    }
    void ctx?.resume()
    ringOnce()
    ringTimerRef.current = setInterval(() => {
      ringOnce()
      try {
        navigator.vibrate?.([400, 200, 400])
      } catch {
        /* not supported */
      }
    }, 2500)

    // Auto-dismiss if nobody answers.
    const giveUp = setTimeout(() => setDing(null), 45_000)

    return () => {
      if (ringTimerRef.current) clearInterval(ringTimerRef.current)
      ringTimerRef.current = null
      clearTimeout(giveUp)
      try {
        navigator.vibrate?.(0)
      } catch {
        /* ignore */
      }
    }
  }, [ding])

  if (!ding) return null

  const answer = () => {
    const id = ding.deviceId
    setDing(null)
    router.push(`/live?device=${encodeURIComponent(id)}&talk=1`)
  }

  return (
    <div className="callOverlay" role="dialog" aria-label="Es klingelt">
      <div className="callCard">
        <div className="callPulse">🔔</div>
        <h2>Es klingelt!</h2>
        <p className="callWho">{ding.deviceName ?? 'Türklingel'}</p>
        <div className="callBtns">
          <button type="button" className="callBtn answer" onClick={answer}>
            📞 Annehmen
          </button>
          <button type="button" className="callBtn decline" onClick={() => setDing(null)}>
            ✕ Ablehnen
          </button>
        </div>
      </div>
    </div>
  )
}
