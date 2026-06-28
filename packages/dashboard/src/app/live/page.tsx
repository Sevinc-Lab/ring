import Link from 'next/link'
import { getLatestDeviceId } from '@/lib/db'
import LivePlayer from './LivePlayer'
import DeviceControls from './DeviceControls'
import BatteryBadge from '../BatteryBadge'

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
        <BatteryBadge deviceId={deviceId} />
        <Link href="/" className="back">
          ← Timeline
        </Link>
      </div>
      <LivePlayer deviceId={deviceId} />
      <DeviceControls deviceId={deviceId} />
    </div>
  )
}
