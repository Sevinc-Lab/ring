'use client'

import { useEffect, useRef, useState } from 'react'

interface Caps {
  hasSiren: boolean
  hasLight: boolean
}

/**
 * Siren / light controls, gated on the camera's real capabilities. The worker
 * reports what the physical device actually supports (camera.hasSiren /
 * hasLight); we only render a button when the hardware is there. A battery
 * Außenkamera that has neither shows an honest note instead of dead buttons.
 *
 * Siren safety (dead-man's switch): while the siren is on, this component pings
 * the worker every few seconds. If the pings stop — tab closed, device
 * unreachable — the worker auto-offs after a grace period (plus a hard cap).
 * So the siren never wails forever, but stays on as long as you're watching.
 */
export default function DeviceControls({ deviceId }: { deviceId: string }) {
  const q = deviceId ? `?device=${encodeURIComponent(deviceId)}` : ''
  const sep = q ? '&' : '?'
  const [caps, setCaps] = useState<Caps | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [siren, setSiren] = useState(false)
  const [light, setLight] = useState(false)
  const [busy, setBusy] = useState<'' | 'siren' | 'light'>('')
  const [error, setError] = useState('')

  const sirenPing = useRef<ReturnType<typeof setInterval> | null>(null)
  const sirenOnRef = useRef(false)

  const stopSirenPing = () => {
    if (sirenPing.current) {
      clearInterval(sirenPing.current)
      sirenPing.current = null
    }
  }

  useEffect(() => {
    let cancelled = false
    fetch(`/api/device/caps${q}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => {
        if (cancelled) return
        if (c) setCaps({ hasSiren: !!c.hasSiren, hasLight: !!c.hasLight })
        setLoaded(true)
      })
      .catch(() => {
        if (!cancelled) setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [q])

  // Turn the siren off if we leave the page while it's on (when reachable; if
  // not, the worker's dead-man's switch handles it).
  useEffect(() => {
    const offBeacon = () => {
      const url = `/api/device/siren${sep}on=false`
      if (navigator.sendBeacon) navigator.sendBeacon(url)
      else fetch(url, { method: 'POST', keepalive: true }).catch(() => {})
    }
    const onHide = () => {
      if (sirenOnRef.current) offBeacon()
    }
    window.addEventListener('pagehide', onHide)
    return () => {
      window.removeEventListener('pagehide', onHide)
      stopSirenPing()
      if (sirenOnRef.current) offBeacon()
    }
  }, [sep])

  async function toggle(control: 'siren' | 'light', next: boolean) {
    setBusy(control)
    setError('')
    try {
      const r = await fetch(`/api/device/${control}${sep}on=${next}`, { method: 'POST' })
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        setError(e.error ? `Fehlgeschlagen: ${e.error}` : 'Befehl fehlgeschlagen.')
        return
      }
      if (control === 'siren') {
        setSiren(next)
        sirenOnRef.current = next
        stopSirenPing()
        if (next) {
          // Keepalive ping: re-asserting on=true bumps the worker's dead-man timer.
          sirenPing.current = setInterval(() => {
            fetch(`/api/device/siren${sep}on=true`, { method: 'POST' }).catch(() => {})
          }, 5000)
        }
      } else {
        setLight(next)
      }
    } catch {
      setError('Worker nicht erreichbar.')
    } finally {
      setBusy('')
    }
  }

  if (!loaded) return null
  if (!caps || (!caps.hasSiren && !caps.hasLight)) {
    return (
      <p className="muted livenote">
        Diese Kamera meldet keine Sirene und kein Licht — die Steuerung steht für dieses Modell nicht
        zur Verfügung.
      </p>
    )
  }

  return (
    <div className="deviceCtl">
      {caps.hasSiren ? (
        <button
          type="button"
          className={`ctlBtn siren${siren ? ' on' : ''}`}
          onClick={() => toggle('siren', !siren)}
          disabled={busy !== ''}
        >
          {siren ? '🚨 Sirene AUS' : '🚨 Sirene EIN'}
        </button>
      ) : null}
      {caps.hasLight ? (
        <button
          type="button"
          className={`ctlBtn light${light ? ' on' : ''}`}
          onClick={() => toggle('light', !light)}
          disabled={busy !== ''}
        >
          {light ? '💡 Licht AUS' : '💡 Licht EIN'}
        </button>
      ) : null}
      {siren ? (
        <span className="muted livenote sirenHint">
          Sirene läuft — schaltet sich automatisch ab, wenn du die Seite verlässt (oder spätestens
          nach 5&nbsp;Minuten).
        </span>
      ) : null}
      {error ? <p className="liveerr">⚠ {error}</p> : null}
    </div>
  )
}
