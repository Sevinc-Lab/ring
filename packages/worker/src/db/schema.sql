-- Canonical reference schema for the local NVR event index.
-- NOTE: repository.ts embeds this same DDL inline (single source of truth at
-- runtime); keep the two in sync. See docs/PLAN.md §6.

CREATE TABLE IF NOT EXISTS events (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  ring_event_id    TEXT,                       -- Ring ding/notification id (dedup); often NULL in M1
  device_id        TEXT NOT NULL,              -- camera.id
  device_name      TEXT,
  kind             TEXT NOT NULL,              -- 'motion' (this model has no doorbell 'ding')
  started_at       TEXT NOT NULL,              -- ISO8601 UTC (event time)

  -- Recording (M2; NULL in M1)
  clip_path        TEXT,                       -- relative path to mp4
  clip_seconds     INTEGER,                    -- configured clip length
  thumb_path       TEXT,                       -- relative path to jpg (FIRST FRAME of recording, see KORREKTUR 1)
  recording_status TEXT NOT NULL DEFAULT 'pending', -- 'pending'|'recorded'|'failed'|'event_only'
  cold_start_ms    INTEGER,                    -- M2 metric: event -> first frame

  -- M4 hook (empty for now)
  label            TEXT NOT NULL DEFAULT 'unclassified',
  label_meta       TEXT,                       -- JSON (scores etc.), later

  -- Operational
  created_at       TEXT NOT NULL,
  error            TEXT
);

CREATE INDEX IF NOT EXISTS idx_events_started ON events(started_at);
CREATE INDEX IF NOT EXISTS idx_events_device  ON events(device_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_ring_id ON events(ring_event_id) WHERE ring_event_id IS NOT NULL;
