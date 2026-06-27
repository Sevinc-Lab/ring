# Architecture

Local, event-driven NVR for a Ring battery camera. Replaces the Ring app/subscription
for basic camera functions; **recordings stay local**. The cloud + a (free) Ring
account remain mandatory for events and live-stream signaling — only the
application/storage layer is local.

See `PLAN.md` for the full design and the approved corrections. This file is the
short map.

## Milestones
- **M1 (this PR):** worker container, token persistence, **motion-event reception**.
  Hard gate: do motion events arrive on the 2K camera at all?
- **M2:** event → `recordToFile` mp4 on SATA + **first-frame thumbnail** (ffmpeg) +
  metadata row; measure cold-start latency & battery impact.
- **M3:** local Next.js + better-sqlite3 dashboard (timeline + playback), reads DB read-only.
- **M4 (deferred):** detection (person/parcel) + targeted notifications via n8n.
  Hooks: `events.label` / `label_meta`.

## Data flow (M1)
```
Ring Cloud ──push──> ring-client-api ──onMotionDetected──> subscriber
                                                              │
                          token rotation                      ▼
   onRefreshTokenUpdated ──> TokenStore (atomic, 0600)   Repository (SQLite)
        /data/secrets/refresh-token                       /data/db/ring.db (events)
```

## Components
| Path | Role |
|---|---|
| `packages/worker/src/index.ts` | Bootstrap, fail-fast auth, heartbeat, graceful shutdown |
| `…/config.ts` | Env validation (zod) |
| `…/auth/tokenStore.ts` | Load (file > env), atomic persist, restart-safe |
| `…/auth/ringClient.ts` | RingApi + `onRefreshTokenUpdated` persistence |
| `…/events/subscriber.ts` | `onMotionDetected` → `events` row (`event_only`) |
| `…/db/repository.ts` | better-sqlite3, embedded schema, idempotent insert |
| `…/recorder/*` | **M2 stub** — corrected first-frame-thumbnail design (KORREKTUR 1) |

## Key constraints baked into the design
- **Event-driven only** — no polling, no continuous stream, no snapshot loops.
- **Token rotation is failure source #1** — atomic writes, file-wins-over-seed, never re-auth in a loop (lockout-safe → fail-fast + exit).
- **Keep + label, never auto-delete** — failures stay as rows; nothing is pruned in M1–M3.
- **Battery camera** — `getSnapshot()` is unreliable during recording; thumbnails come from the recording's first frame (M2).
