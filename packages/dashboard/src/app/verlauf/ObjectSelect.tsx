'use client'

import { useRouter } from 'next/navigation'

/** "Alle Objekte / <object>" dropdown. Filters events that contain the chosen
 *  YOLO object tag (e.g. laptop, car, backpack), keeping the label + camera
 *  filters and jumping back to page 1. */
export default function ObjectSelect({
  objects,
  selected,
  label,
  device,
}: {
  objects: string[]
  selected: string
  label: string
  device: string
}) {
  const router = useRouter()
  if (objects.length === 0) return null
  return (
    <label className="camSelect">
      <span className="camSelIcon">🔖</span>
      <select
        value={selected}
        onChange={(e) => {
          const params = new URLSearchParams()
          if (label && label !== 'all') params.set('label', label)
          if (device) params.set('device', device)
          if (e.target.value) params.set('object', e.target.value)
          const qs = params.toString()
          router.push(qs ? `/verlauf?${qs}` : '/verlauf')
        }}
      >
        <option value="">Alle Objekte</option>
        {objects.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  )
}
