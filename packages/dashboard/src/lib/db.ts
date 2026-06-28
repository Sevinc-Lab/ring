import Database from 'better-sqlite3'

/**
 * Read-only access to the worker's SQLite index.
 *
 * The connection is opened `readonly: true` — the dashboard never writes the
 * index, it only reads it. (The db volume is mounted read-write in compose so
 * SQLite's WAL shared-memory works across the two containers, but this
 * connection still cannot modify a single row.)
 */
const DB_PATH = process.env.DATA_DB_PATH || '/data/db/ring.db'

export interface EventRow {
  id: number
  device_id: string
  device_name: string | null
  kind: string
  started_at: string
  recording_status: string
  clip_path: string | null
  thumb_path: string | null
  clip_seconds: number | null
  cold_start_ms: number | null
  label: string
  objects: string | null
}

let _db: Database.Database | null = null

function db(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH, { readonly: true, fileMustExist: true })
    _db.pragma('busy_timeout = 5000')
  }
  return _db
}

const SELECT_COLS = `id, device_id, device_name, kind, started_at, recording_status,
  clip_path, thumb_path, clip_seconds, cold_start_ms, label, objects`

/** Whitelisted label filters (M4b). 'all' = no filter. */
export const LABEL_FILTERS = ['all', 'person', 'dog', 'cat', 'car', 'none', 'unclassified'] as const
export type LabelFilter = (typeof LABEL_FILTERS)[number]

export function normalizeLabel(raw: string | undefined): LabelFilter {
  return (LABEL_FILTERS as readonly string[]).includes(raw ?? '')
    ? (raw as LabelFilter)
    : 'all'
}

function buildWhere(
  label: LabelFilter,
  deviceId?: string,
  object?: string,
): { sql: string; params: string[] } {
  const cond: string[] = []
  const params: string[] = []
  if (label !== 'all') {
    cond.push('label = ?')
    params.push(label)
  }
  if (deviceId) {
    cond.push('device_id = ?')
    params.push(deviceId)
  }
  if (object) {
    // Tags are stored as ",person,laptop,cup," — match a whole tag.
    cond.push('objects LIKE ?')
    params.push(`%,${object},%`)
  }
  return { sql: cond.length ? `WHERE ${cond.join(' AND ')}` : '', params }
}

export function listEvents(
  limit: number,
  offset: number,
  label: LabelFilter = 'all',
  deviceId?: string,
  object?: string,
): EventRow[] {
  const w = buildWhere(label, deviceId, object)
  return db()
    .prepare(
      `SELECT ${SELECT_COLS} FROM events ${w.sql} ORDER BY started_at DESC, id DESC LIMIT ? OFFSET ?`,
    )
    .all(...w.params, limit, offset) as EventRow[]
}

/** Distinct object tags seen across all events (for the Verlauf object filter). */
export function listObjectTags(): string[] {
  const rows = db()
    .prepare(`SELECT DISTINCT objects FROM events WHERE objects IS NOT NULL AND objects != ''`)
    .all() as { objects: string }[]
  const set = new Set<string>()
  for (const r of rows) for (const t of r.objects.split(',')) if (t) set.add(t)
  return [...set].sort()
}

export function getEvent(id: number): EventRow | undefined {
  return db()
    .prepare(`SELECT ${SELECT_COLS} FROM events WHERE id = ?`)
    .get(id) as EventRow | undefined
}

/** Most recently seen camera id (for the live view default). */
export function getLatestDeviceId(): string | null {
  const row = db().prepare(`SELECT device_id FROM events ORDER BY id DESC LIMIT 1`).get() as
    | { device_id: string }
    | undefined
  return row?.device_id ?? null
}

export interface DeviceRow {
  device_id: string
  device_name: string | null
  last_event_at: string | null
  last_thumb_path: string | null
  last_event_id: number | null
  event_count: number
}

/**
 * One row per camera seen in the index, newest activity first. Each carries its
 * most recent event (for a static snapshot tile) and total event count. Used by
 * the Dashboard overview as the battery-safe source of camera tiles — and as a
 * fallback list when the worker's /devices endpoint is unreachable.
 */
export function listDevices(): DeviceRow[] {
  return db()
    .prepare(
      `SELECT e.device_id        AS device_id,
              e.device_name      AS device_name,
              e.started_at       AS last_event_at,
              e.thumb_path       AS last_thumb_path,
              e.id               AS last_event_id,
              c.n                AS event_count
       FROM events e
       JOIN (
         SELECT device_id, MAX(id) AS max_id, COUNT(*) AS n
         FROM events GROUP BY device_id
       ) c ON c.max_id = e.id
       ORDER BY e.started_at DESC, e.id DESC`,
    )
    .all() as DeviceRow[]
}

export function countEvents(
  label: LabelFilter = 'all',
  deviceId?: string,
  object?: string,
): number {
  const w = buildWhere(label, deviceId, object)
  const row = db().prepare(`SELECT COUNT(*) AS n FROM events ${w.sql}`).get(...w.params) as {
    n: number
  }
  return row.n
}
