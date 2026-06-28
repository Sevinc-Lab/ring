import Link from 'next/link'
import { listDevices, type DeviceRow } from '@/lib/db'
import { getWorkerDevices, type WorkerDevice } from '@/lib/device'
import { fmtTime } from '@/lib/format'

export const dynamic = 'force-dynamic'

interface CameraTile {
  deviceId: string
  name: string
  hasBattery: boolean
  batteryLevel: number | null
  hasLowBattery: boolean
  operatingOnBattery: boolean | null
  online: boolean
  lastThumb: string | null
  lastEventAt: string | null
  lastEventId: number | null
  eventCount: number
}

function battery(level: number, low: boolean, onBattery: boolean | null) {
  const lvl = Math.max(0, Math.min(100, Math.round(level)))
  const isLow = low || lvl <= 20
  const cls = isLow ? 'low' : lvl <= 40 ? 'mid' : 'ok'
  const icon = onBattery === false ? '🔌' : isLow ? '🪫' : '🔋'
  return { lvl, cls, icon }
}

/** Merge the worker's live camera list (caps + battery) with the DB index
 *  (last snapshot + counts). Worker is the spine when reachable; otherwise we
 *  fall back to whatever cameras the index has seen. */
function buildTiles(worker: WorkerDevice[] | null, db: DeviceRow[]): CameraTile[] {
  const dbById = new Map(db.map((d) => [d.device_id, d]))
  const fromWorker = (w: WorkerDevice): CameraTile => {
    const d = dbById.get(w.deviceId)
    return {
      deviceId: w.deviceId,
      name: w.name || d?.device_name || 'Kamera',
      hasBattery: !!w.hasBattery,
      batteryLevel: w.batteryLevel ?? null,
      hasLowBattery: !!w.hasLowBattery,
      operatingOnBattery: w.operatingOnBattery ?? null,
      online: true,
      lastThumb: d?.last_thumb_path ?? null,
      lastEventAt: d?.last_event_at ?? null,
      lastEventId: d?.last_event_id ?? null,
      eventCount: d?.event_count ?? 0,
    }
  }
  if (worker && worker.length) return worker.map(fromWorker)
  return db.map((d) => ({
    deviceId: d.device_id,
    name: d.device_name ?? 'Kamera',
    hasBattery: false,
    batteryLevel: null,
    hasLowBattery: false,
    operatingOnBattery: null,
    online: false,
    lastThumb: d.last_thumb_path,
    lastEventAt: d.last_event_at,
    lastEventId: d.last_event_id,
    eventCount: d.event_count,
  }))
}

export default async function DashboardPage() {
  let dbDevices: DeviceRow[] = []
  let dbOk = true
  try {
    dbDevices = listDevices()
  } catch {
    dbOk = false
  }
  const workerDevices = await getWorkerDevices()
  const tiles = buildTiles(workerDevices, dbDevices)

  return (
    <div className="wrap">
      <div className="topbar">
        <h1>Dashboard</h1>
        <span className="count">
          {tiles.length} Kamera{tiles.length === 1 ? '' : 's'}
        </span>
      </div>

      {tiles.length === 0 ? (
        <p className="empty">
          {dbOk
            ? 'Noch keine Kamera gesehen. Sobald der Worker verbunden ist und ein Event eintrifft, erscheint sie hier.'
            : 'Warte auf den Worker / die SQLite-Datenbank unter DATA_DB_PATH.'}
        </p>
      ) : (
        <div className="camGrid">
          {tiles.map((c) => {
            const b = c.hasBattery && c.batteryLevel != null
              ? battery(c.batteryLevel, c.hasLowBattery, c.operatingOnBattery)
              : null
            return (
              <div key={c.deviceId} className="camCard">
                <Link href={`/live?device=${encodeURIComponent(c.deviceId)}`} className="camThumb">
                  {c.lastThumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/media/${c.lastThumb}`} alt="" loading="lazy" />
                  ) : (
                    <div className="noThumb">kein Bild</div>
                  )}
                  <span className="liveTag">🔴 Live</span>
                </Link>
                <div className="camMeta">
                  <span className="camName">{c.name}</span>
                  <span className="camRow">
                    {b ? (
                      <span className={`battery ${b.cls}`} title={`Akku: ${b.lvl}%`}>
                        {b.icon} {b.lvl}%
                      </span>
                    ) : null}
                    {c.eventCount > 0 ? (
                      <Link href="/verlauf" className="camEvents">
                        {c.eventCount} Event{c.eventCount === 1 ? '' : 's'}
                      </Link>
                    ) : null}
                  </span>
                  <span className="camLast">
                    {c.lastEventAt ? `Zuletzt: ${fmtTime(c.lastEventAt)}` : 'Noch kein Event'}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {workerDevices === null ? (
        <p className="muted dashnote">
          Worker nicht erreichbar — zeige zwischengespeicherte Kameras aus dem Verlauf. Akkustand und
          Live brauchen den laufenden Worker.
        </p>
      ) : null}
    </div>
  )
}
