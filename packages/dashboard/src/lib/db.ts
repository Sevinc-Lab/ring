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
  clip_path, thumb_path, clip_seconds, cold_start_ms, label`

/** Whitelisted label filters (M4b). 'all' = no filter. */
export const LABEL_FILTERS = ['all', 'person', 'none', 'unclassified'] as const
export type LabelFilter = (typeof LABEL_FILTERS)[number]

export function normalizeLabel(raw: string | undefined): LabelFilter {
  return (LABEL_FILTERS as readonly string[]).includes(raw ?? '')
    ? (raw as LabelFilter)
    : 'all'
}

function labelWhere(label: LabelFilter): { sql: string; params: string[] } {
  return label === 'all' ? { sql: '', params: [] } : { sql: 'WHERE label = ?', params: [label] }
}

export function listEvents(limit: number, offset: number, label: LabelFilter = 'all'): EventRow[] {
  const w = labelWhere(label)
  return db()
    .prepare(
      `SELECT ${SELECT_COLS} FROM events ${w.sql} ORDER BY started_at DESC, id DESC LIMIT ? OFFSET ?`,
    )
    .all(...w.params, limit, offset) as EventRow[]
}

export function getEvent(id: number): EventRow | undefined {
  return db()
    .prepare(`SELECT ${SELECT_COLS} FROM events WHERE id = ?`)
    .get(id) as EventRow | undefined
}

export function countEvents(label: LabelFilter = 'all'): number {
  const w = labelWhere(label)
  const row = db().prepare(`SELECT COUNT(*) AS n FROM events ${w.sql}`).get(...w.params) as {
    n: number
  }
  return row.n
}
