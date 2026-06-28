'use client'

import { useEffect, useState } from 'react'

interface Caps {
  hasBattery?: boolean
  batteryLevel?: number | null
  hasLowBattery?: boolean
  operatingOnBattery?: boolean
}

/** 🔋 charge level for the camera, polled from the worker's cached device
 *  data (no wake / no battery drain). Hidden for non-battery devices or when
 *  the level is unknown. Refreshes occasionally so it stays roughly current. */
export default function BatteryBadge({ deviceId }: { deviceId: string }) {
  const q = deviceId ? `?device=${encodeURIComponent(deviceId)}` : ''
  const [caps, setCaps] = useState<Caps | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = () =>
      fetch(`/api/device/caps${q}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((c) => {
          if (!cancelled && c) setCaps(c)
        })
        .catch(() => {})
    load()
    const t = setInterval(load, 60_000)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [q])

  if (!caps || !caps.hasBattery || caps.batteryLevel == null) return null

  const level = Math.max(0, Math.min(100, Math.round(caps.batteryLevel)))
  const low = caps.hasLowBattery || level <= 20
  const mid = !low && level <= 40
  const cls = low ? 'low' : mid ? 'mid' : 'ok'
  const icon = caps.operatingOnBattery === false ? '🔌' : low ? '🪫' : '🔋'

  return (
    <span className={`battery ${cls}`} title={`Akku: ${level}%`}>
      {icon} {level}%
    </span>
  )
}
