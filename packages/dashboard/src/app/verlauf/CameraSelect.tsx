'use client'

import { useRouter } from 'next/navigation'

interface Cam {
  id: string
  name: string
}

/** "Alle Kameras / <Kamera>" dropdown. Switching the camera keeps the current
 *  label filter and jumps back to page 1. */
export default function CameraSelect({
  cams,
  selected,
  label,
}: {
  cams: Cam[]
  selected: string
  label: string
}) {
  const router = useRouter()
  return (
    <label className="camSelect">
      <span className="camSelIcon">📹</span>
      <select
        value={selected}
        onChange={(e) => {
          const params = new URLSearchParams()
          if (label && label !== 'all') params.set('label', label)
          if (e.target.value) params.set('device', e.target.value)
          const qs = params.toString()
          router.push(qs ? `/verlauf?${qs}` : '/verlauf')
        }}
      >
        <option value="">Alle Kameras</option>
        {cams.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </label>
  )
}
