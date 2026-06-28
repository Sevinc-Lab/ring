import Database from 'better-sqlite3'
import { mkdirSync } from 'fs'
import { dirname } from 'path'
import type { Logger } from '../log'

/**
 * Embedded DDL — single source of truth at runtime. Mirrors db/schema.sql.
 * Kept inline so the compiled worker never depends on a copied .sql file path.
 */
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS events (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  ring_event_id    TEXT,
  device_id        TEXT NOT NULL,
  device_name      TEXT,
  kind             TEXT NOT NULL,
  started_at       TEXT NOT NULL,
  clip_path        TEXT,
  clip_seconds     INTEGER,
  thumb_path       TEXT,
  recording_status TEXT NOT NULL DEFAULT 'pending',
  cold_start_ms    INTEGER,
  label            TEXT NOT NULL DEFAULT 'unclassified',
  label_meta       TEXT,
  created_at       TEXT NOT NULL,
  error            TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_started ON events(started_at);
CREATE INDEX IF NOT EXISTS idx_events_device  ON events(device_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_ring_id ON events(ring_event_id) WHERE ring_event_id IS NOT NULL;
`

export type RecordingStatus = 'pending' | 'recorded' | 'failed' | 'event_only'

export interface NewEvent {
  ringEventId?: string | null
  deviceId: string
  deviceName?: string | null
  kind: string
  startedAt: string // ISO8601 UTC
  recordingStatus: RecordingStatus
}

export interface RecordingUpdate {
  recordingStatus: RecordingStatus
  clipPath?: string | null
  thumbPath?: string | null
  clipSeconds?: number | null
  coldStartMs?: number | null
  error?: string | null
}

export class Repository {
  private readonly db: Database.Database

  constructor(dbPath: string, log: Logger) {
    mkdirSync(dirname(dbPath), { recursive: true })
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('busy_timeout = 5000')
    this.db.exec(SCHEMA_SQL)
    log.info({ dbPath }, 'SQLite ready')
  }

  /**
   * Insert an event row. Returns the new row id, or null when the event was a
   * duplicate (same ring_event_id) — which we treat as a harmless no-op.
   */
  insertEvent(e: NewEvent): number | null {
    const stmt = this.db.prepare(
      `INSERT INTO events
         (ring_event_id, device_id, device_name, kind, started_at, recording_status, created_at)
       VALUES
         (@ringEventId, @deviceId, @deviceName, @kind, @startedAt, @recordingStatus, @createdAt)`,
    )
    try {
      const info = stmt.run({
        ringEventId: e.ringEventId ?? null,
        deviceId: e.deviceId,
        deviceName: e.deviceName ?? null,
        kind: e.kind,
        startedAt: e.startedAt,
        recordingStatus: e.recordingStatus,
        createdAt: new Date().toISOString(),
      })
      return Number(info.lastInsertRowid)
    } catch (err: any) {
      if (typeof err?.code === 'string' && err.code.startsWith('SQLITE_CONSTRAINT')) {
        return null // duplicate ring_event_id — ignore
      }
      throw err
    }
  }

  /** Update the recording outcome of an event row (M2). Never deletes rows. */
  updateRecording(id: number, u: RecordingUpdate): void {
    this.db
      .prepare(
        `UPDATE events SET
           recording_status = @recordingStatus,
           clip_path        = @clipPath,
           thumb_path       = @thumbPath,
           clip_seconds     = @clipSeconds,
           cold_start_ms    = @coldStartMs,
           error            = @error
         WHERE id = @id`,
      )
      .run({
        id,
        recordingStatus: u.recordingStatus,
        clipPath: u.clipPath ?? null,
        thumbPath: u.thumbPath ?? null,
        clipSeconds: u.clipSeconds ?? null,
        coldStartMs: u.coldStartMs ?? null,
        error: u.error ?? null,
      })
  }

  /** Clip + thumb paths for one event (for local deletion), or undefined. */
  getEventPaths(id: number): { clip_path: string | null; thumb_path: string | null } | undefined {
    return this.db.prepare(`SELECT clip_path, thumb_path FROM events WHERE id = ?`).get(id) as
      | { clip_path: string | null; thumb_path: string | null }
      | undefined
  }

  /**
   * Delete ONE event row from the local index. Returns true if a row was
   * removed. This only ever touches our own SQLite — it never contacts Ring.
   */
  deleteEvent(id: number): boolean {
    const info = this.db.prepare(`DELETE FROM events WHERE id = ?`).run(id)
    return info.changes > 0
  }

  close(): void {
    this.db.close()
  }
}
