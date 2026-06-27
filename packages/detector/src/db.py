"""SQLite access for the detector — second writer, ONLY label/label_meta.

Hard invariants (M4): never delete, only label; touch exclusively rows that are
`recording_status='recorded' AND label='unclassified'`. event_only / failed /
pending rows are never read or written here.
"""
from __future__ import annotations

import json
import sqlite3


def connect(db_path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path, timeout=10)
    conn.execute("PRAGMA busy_timeout = 5000")
    conn.row_factory = sqlite3.Row
    return conn


def fetch_unclassified(conn: sqlite3.Connection, limit: int = 10) -> list[dict]:
    cur = conn.execute(
        """SELECT id, device_id, device_name, started_at, clip_path, thumb_path
             FROM events
            WHERE recording_status = 'recorded'
              AND label = 'unclassified'
              AND clip_path IS NOT NULL
            ORDER BY id ASC
            LIMIT ?""",
        (limit,),
    )
    return [dict(r) for r in cur.fetchall()]


def update_label(conn: sqlite3.Connection, event_id: int, label: str, label_meta: dict) -> None:
    conn.execute(
        "UPDATE events SET label = ?, label_meta = ? WHERE id = ?",
        (label, json.dumps(label_meta, separators=(",", ":")), event_id),
    )
    conn.commit()
