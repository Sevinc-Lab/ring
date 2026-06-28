import Link from 'next/link'
import { getLatestDeviceId } from '@/lib/db'
import LivePlayer from './LivePlayer'
import DeviceControls from './DeviceControls'
import BatteryBadge from '../BatteryBadge'

export const dynamic = 'force-dynamic'

export default function LivePage({
  searchParams,
}: {
  searchParams: { device?: string; talk?: string }
}) {
  // Prefer the camera picked on the Dashboard; fall back to the most recent one.
  let deviceId = searchParams.device ?? ''
  if (!deviceId) {
    try {
      deviceId = getLatestDeviceId() ?? ''
    } catch {
      deviceId = ''
    }
  }
  const autoTalk = searchParams.talk === '1' // answered a doorbell call → hands-free
  return (
    <div className="wrap">
      <div className="topbar">
        <h1>🔴 Live</h1>
        <BatteryBadge deviceId={deviceId} />
        <Link href="/" className="back">
          ← Dashboard
        </Link>
      </div>
      <LivePlayer deviceId={deviceId} autoTalk={autoTalk} />
      <DeviceControls deviceId={deviceId} />
    </div>
  )
}
