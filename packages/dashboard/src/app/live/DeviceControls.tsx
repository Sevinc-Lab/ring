'use client'

import { useEffect, useState } from 'react'

interface Caps {
  hasSiren: boolean
  hasLight: boolean
}

/**
 * Siren / light controls, gated on the camera's real capabilities. The worker
 * reports what the physical device actually supports (camera.hasSiren /
 * hasLight); we only render a button when the hardware is there. A battery
 * Außenkamera that has neither shows an honest note instead of dead buttons.
 */
export default function DeviceControls({ deviceId }: { deviceId: string }) {
  const q = deviceId ? `?device=${encodeURIComponent(deviceId)}` : ''
  const [caps, setCaps] = useState<Caps | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [siren, setSiren] = useState(false)
  const [light, setLight] = useState(false)
  const [busy, setBusy] = useState<'' | 'siren' | 'light'>('')
  const [error, setError] = useState('')

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

  async function toggle(control: 'siren' | 'light', next: boolean) {
    setBusy(control)
    setError('')
    try {
      const r = await fetch(`/api/device/${control}${q ? q + '&' : '?'}on=${next}`, {
        method: 'POST',
      })
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        setError(e.error ? `Fehlgeschlagen: ${e.error}` : 'Befehl fehlgeschlagen.')
        return
      }
      if (control === 'siren') setSiren(next)
      else setLight(next)
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
      {error ? <p className="liveerr">⚠ {error}</p> : null}
    </div>
  )
}
