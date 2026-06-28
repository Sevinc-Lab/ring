import Link from 'next/link'
import { getLatestDeviceId } from '@/lib/db'
import LivePlayer from './LivePlayer'

export const dynamic = 'force-dynamic'

export default function LivePage() {
  let deviceId = ''
  try {
    deviceId = getLatestDeviceId() ?? ''
  } catch {
    deviceId = ''
  }
  return (
    <div className="wrap">
      <div className="topbar">
        <h1>🔴 Live</h1>
        <Link href="/" className="back">
          ← Timeline
        </Link>
      </div>
      <LivePlayer deviceId={deviceId} />
    </div>
  )
}
