# PLAN — Lokales, event-getriebenes NVR für Ring-Akku-Cam

> Status: **freigegeben** (Review durch Architekt) mit 3 Pflicht-Korrekturen + Entscheidungen A/B/C.
> Dieses Dokument ist die maßgebliche Referenz. Korrekturen sind unten **fett als `KORREKTUR`** markiert.

## 0. Leitprinzipien
- **Cloud-Pflicht akzeptiert** — lokal ist nur App-/Storage-Layer (Aufnahmen, Dashboard, Logik, Metadaten).
- **Event-getrieben, minimale API-Calls** — kein Polling, keine Snapshot-Loops, keine Daueraufnahme.
- **Token-Rotation ist Risiko #1** → robuste Persistenz + atomare Writes, **nie** Re-Auth-Loop (Lockout-Gefahr).
- **Behalten + labeln, nie auto-löschen** in M1–M3.
- **M4 (KI) andockbar, nicht gebaut** → `label`-Feld jetzt reservieren.
- **Architektur-Regel:** Worker bleibt „dumm & robust" (nur aufnehmen + indexieren). Spätere Intelligenz (KI, Notifications, Retention) dockt an **SQLite-Tabelle + Dateien** an, nicht an den Worker-Code.

---

## 1. Entscheidungen (A/B/C)

| | Entscheidung | Konsequenz |
|---|---|---|
| **A — Modell** | **Ring Außenkamera Plus Akku (2K)** / engl. *Outdoor Camera Plus Battery*, neueste Generation. ASIN B0D23VW9VB (Farbvariante von B0D23XCY18). | Reine Außenkamera, **kein Klingelknopf, kein Licht/Sirene** → **nur Motion-Events, kein Ding**. Event-Flow = wie *Stick Up Cam Battery*. |
| **B — Clip-Länge** | `CLIP_SECONDS` **Default = 30** | Konfigurierbar via `.env`. Akku-schonend. |
| **C — Dashboard (M3)** | **Next.js + better-sqlite3** | Gleicher TS-Stack wie Worker, SSR-Timeline + Playback, einfacher Docker-Build. Erst in M3 gebaut. |

---

## 2. Verifizierte API-Basis (`ring-client-api`, dgreif/ring)

| Zweck | API |
|---|---|
| Auth | `new RingApi({ refreshToken, controlCenterDisplayName })` |
| Token-Rotation | `ringApi.onRefreshTokenUpdated.subscribe(({ newRefreshToken }) => persist(...))` |
| Geräte | `await ringApi.getCameras()` |
| Motion-Event | `camera.onMotionDetected.subscribe(motion => …)` *(boolean; primäres M1-Signal)* |
| Roh-Push | `camera.onNewNotification` *(reichere Metadaten, best-effort)* |
| Snapshot | `await camera.getSnapshot()` → `Promise<Buffer>` — **siehe KORREKTUR 1: bei Akku-Cam unzuverlässig** |
| Clip-Aufnahme | `await camera.recordToFile(outputPath, durationSeconds)` *(weckt Stream, schreibt via ffmpeg)* |
| Stream (Custom) | `camera.streamVideo({...})` / `startVideoOnDemand()` *(Fallback, eigener ffmpeg-Pfad)* |

> Maintainer-bestätigt (dgreif/ring #1403): Ohne Ring-Abo funktioniert genau unser Pfad — Event empfangen → Live-Stream starten → in Datei aufnehmen. Keine Cloud-Event-History nötig.

---

## 3. KORREKTUREN (Pflicht, eingearbeitet)

### KORREKTUR 1 — Thumbnail aus dem ersten Frame der Aufnahme, NICHT aus `getSnapshot()`
Bei Akku-/Low-Power-Kameras kann das Gerät **nicht snapshotten, während es aufnimmt** — und jedes Motion-Event startet eine Aufnahme. Der ursprüngliche M2-Plan („`getSnapshot()` parallel als Cold-Start-Fallback → es gibt immer ein Thumbnail") ist für dieses Modell **schlicht falsch**.

**Korrigiertes M2-Verhalten:**
- Thumbnail wird aus dem **ersten Frame der `recordToFile`-Aufnahme** via **ffmpeg** abgeleitet
  (`ffmpeg -i <clip.mp4> -frames:v 1 -q:v 2 <thumb.jpg>`, bzw. direkt beim Schreiben).
- `getSnapshot()` ist **höchstens „best effort"** (per `RECORD_SNAPSHOT`-Flag, Default **false**) und **niemals** ein verlässlicher Fallback.
- **Fällt die Aufnahme komplett aus → kein Thumbnail.** Die `events`-Row bleibt trotzdem bestehen (`recording_status='failed'`), nichts wird gelöscht.

### KORREKTUR 2 — M1-Gate #2 ist ein hartes No-Go (2K-Modell-Risiko)
Das gewählte Gerät ist die **neueste 2K-Generation (Außenkamera Plus Akku)**. Genau diese Generation hatte im **Oktober 2025** in der Schwester-Library `python-ring-doorbell` (Home Assistant Issue #155020) **fehlende Motion-Events / Motion-Steuerung**. Das ist kein Beweis, dass `ring-client-api` (TS) scheitert, aber ein **klares gelbes Warnsignal**.

**Hartes Gate vor jeglichem M2-Bau:**
> **M1-Gate #2:** Kommen bei **genau dieser 2K-Kamera** überhaupt **echte Motion-Events** in Echtzeit an?
> - **Ja** → weiter zu M2.
> - **Nein** → **Projekt mit dieser Hardware gestoppt.** NICHT weiterbauen. Kein M2.

Dies ist **kein Nebenrisiko**, sondern ein Abbruchkriterium. Siehe Verify M1.

### KORREKTUR 3 — Push-/Firebase-Token-Stolperstein im Token-Flow + SETUP.md
Bekannte Eigenheit der inoffiziellen API:
- Push-/Motion-Events kommen u.U. **erst zuverlässig an, nachdem das Gerät/der Client im Ring **Control Center** entfernt und ein **neuer Token** generiert wurde**.
- **Andere aktive Ring-Clients** (insb. die laufende Ring-Handy-App) können ein Event **„wegschnappen"**, sodass der Worker es nicht sieht.

→ Als **Troubleshooting-Schritt** in `tokenStore`-Doku und **`SETUP.md`** dokumentiert (eigener Abschnitt „Es kommen keine Events an"). Mitigation für den Test: Handy-App testweise schließen / Control-Center-Eintrag neu erzeugen.

---

## 4. Container-Layout & CasaOS/Docker-Setup

**M1–M2: ein Container** (`ring-worker`). **M3-Dashboard** kommt als zweiter Container dazu, mountet dieselben Volumes **read-only**.

```
ZimaBlade / CasaOS  (Docker)
└── docker-compose.yml
    ├── ring-worker      (Node 20 LTS Alpine + ffmpeg)
    │     volumes:
    │       /DATA/ring/media   → /data/media   (rw)   # mp4 + jpg (Thumbnail aus 1. Frame)
    │       /DATA/ring/db      → /data/db      (rw)   # sqlite + heartbeat
    │       /DATA/ring/secrets → /data/secrets (rw)   # refresh token (0600)
    │     restart: unless-stopped
    │     env_file: .env
    └── ring-dashboard   (M3, später; Next.js)
          volumes:
            /DATA/ring/media → /data/media (ro)
            /DATA/ring/db    → /data/db    (ro)
          ports: ["8080:8080"]
          restart: unless-stopped
```

- **`restart: unless-stopped`** → übersteht Reboots/Container-Restarts; mit Token-Persistenz = Wiederanlauf ohne 2FA.
- **Alle State-Volumes auf SATA `/DATA/...`** (CasaOS-Konvention) — nichts im Container-Layer.
- **`ffmpeg` im Image** (Alpine), Multi-stage Build.
- **Heartbeat-Datei** (`/data/db/.heartbeat`) + Docker-HEALTHCHECK → CasaOS-Statusanzeige.
- Worker läuft für M1 als root (Schreibrechte auf `/DATA` ohne uid-Mapping-Stolperfallen). Härtung optional später.

---

## 5. Repo-/Verzeichnisstruktur (GitHub-Org: Sevinc-Lab, Repo `ring`)

```
ring/
├── README.md
├── docker-compose.yml
├── .env.example
├── docs/
│   ├── PLAN.md                 # dieses Dokument
│   ├── SETUP.md                # idiotensichere Schritt-für-Schritt-Anleitung
│   └── ARCHITECTURE.md         # Milestones, Datenfluss, Andock-Punkte M2–M4
└── packages/
    └── worker/                 # M1 (gebaut) + M2-Andockstellen (Stubs)
        ├── Dockerfile
        ├── package.json
        ├── tsconfig.json
        ├── src/
        │   ├── index.ts        # Bootstrap, fail-fast, graceful shutdown, heartbeat
        │   ├── config.ts       # Env laden + validieren (zod)
        │   ├── log.ts          # pino, LOG_LEVEL
        │   ├── auth/
        │   │   ├── tokenStore.ts   # load (file>env), atomarer Write, Persistenz
        │   │   └── ringClient.ts   # RingApi + onRefreshTokenUpdated
        │   ├── events/
        │   │   └── subscriber.ts   # onMotionDetected → events-Row (M1)
        │   ├── recorder/
        │   │   ├── paths.ts        # Datei-/Pfadschema
        │   │   └── recorder.ts     # M2-STUB: recordToFile + 1.-Frame-Thumbnail (KORREKTUR 1)
        │   └── db/
        │       ├── schema.sql      # kanonisches Schema (Referenz)
        │       └── repository.ts   # better-sqlite3 Insert/Query (inline schema = source of truth)
        └── test/
# packages/dashboard/  → erst M3 (Next.js + better-sqlite3)
# packages/detector/   → erst M4 (deferred)
```

---

## 6. SQLite-Schema (zukunftssicher M2–M4)

```sql
CREATE TABLE IF NOT EXISTS events (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  ring_event_id    TEXT,                       -- Rings ding/notification id (Dedup), oft NULL in M1
  device_id        TEXT NOT NULL,              -- camera.id
  device_name      TEXT,
  kind             TEXT NOT NULL,              -- 'motion' (dieses Modell: kein 'ding')
  started_at       TEXT NOT NULL,              -- ISO8601 UTC (Event-Zeit)
  -- Recording (M2; in M1 NULL)
  clip_path        TEXT,                       -- rel. Pfad mp4
  clip_seconds     INTEGER,                    -- konfigurierte Länge
  thumb_path       TEXT,                       -- rel. Pfad jpg (1. Frame der Aufnahme; KORREKTUR 1)
  recording_status TEXT NOT NULL DEFAULT 'pending',
                                               -- 'pending'|'recorded'|'failed'|'event_only'
  cold_start_ms    INTEGER,                    -- M2-Messung: Event→erster Frame
  -- M4-Andockpunkt (jetzt leer)
  label            TEXT NOT NULL DEFAULT 'unclassified',
  label_meta       TEXT,                       -- JSON (Scores etc.), später
  -- Betrieb
  created_at       TEXT NOT NULL,
  error            TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_started ON events(started_at);
CREATE INDEX IF NOT EXISTS idx_events_device  ON events(device_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_ring_id ON events(ring_event_id) WHERE ring_event_id IS NOT NULL;
```

**Begründungen:**
- `thumb_path` (statt `snapshot_path`) macht KORREKTUR 1 explizit: Quelle ist der **erste Aufnahme-Frame**, nicht `getSnapshot()`.
- `recording_status` trennt M1 (`event_only`) sauber von M2 (`recorded`/`failed`) — **nie löschen**, auch Fehler bleiben.
- `cold_start_ms` = exakte M2-Verify-Metrik.
- `label`/`label_meta` = M4-Hook, jetzt `unclassified`, kein Code dafür.
- Pfade **relativ** zum Media-Root → Volume-Umzug bricht nichts.

---

## 7. Token-Flow (kritisch — KORREKTUR 3 berücksichtigt)

**Einmalig, manuell (dokumentiert in `SETUP.md`), erst beim ersten echten Start:**
1. `ring-auth-cli` (via Docker, kein Node-Install nötig) → 2FA → initialer Refresh-Token.
2. Token als `RING_REFRESH_TOKEN` in `.env` eintragen (**nur Seed**).

**Im Worker (`tokenStore.ts`):**
- **Lade-Priorität: Datei `> ` env.** Persistierter (rotierter) Token gewinnt über veralteten Seed.
- **`onRefreshTokenUpdated`** → bei jeder Rotation **atomar** persistieren (`*.tmp` schreiben, dann `rename()`), Mode `0600`. Kein korruptes Token bei Crash mid-write.
- **Kein Re-Auth-Loop:** Auth-Fehler (Token tot) → **FATAL-Log + `exit(1)`** (kein Retry-Sturm). CasaOS-Restart bringt den Container zurück; ist der Token wirklich tot, bleibt der Fehler sichtbar → manueller Neu-Auth.
- **KORREKTUR 3 (Push-Stolperstein):** Falls keine Events ankommen, dokumentierter Pfad: Gerät/Client im Ring **Control Center** entfernen + **neuen Token** generieren; **Ring-Handy-App schließen** (kann Events wegschnappen). Siehe SETUP §„Es kommen keine Events an".

---

## 8. Event → Record-Flow

**M1 (nur Empfang, kein Clip):**
```
RingApi(refreshToken) → getCameras()  [fail-fast bei Auth-Fehler]
  → camera.onMotionDetected.subscribe(true)
    → events/subscriber.ts
      → INSERT events(kind='motion', started_at, recording_status='event_only')
      → klare Log-Zeile "MOTION event received" (Gate-Sichtbarkeit)
```

**M2 (Aufnahme — korrigiert):**
```
Event  → t0 = now()
  1. INSERT row (recording_status='pending', started_at)
  2. camera.recordToFile(path, CLIP_SECONDS)        (weckt Stream)
       → erster Frame: cold_start_ms = now() - t0
  3. ffmpeg: erstes Frame des Clips → thumb.jpg     (KORREKTUR 1: KEIN getSnapshot)
  4. success: UPDATE (clip_path, thumb_path, clip_seconds, cold_start_ms, status='recorded')
     error:   UPDATE (status='failed', error=...)   -- Row bleibt, evtl. kein Thumbnail
```
- **Kein paralleler Zweitclip pro Kamera** (Akku-Schonung); überlappende Events während laufender Aufnahme werden als Row geloggt, aber nicht gleichzeitig gestreamt (Lock/Debounce pro `device_id`).
- **Dateischema:** `/<device_id>/<YYYY-MM-DD>/<epoch>_motion.mp4` + `.jpg`.

---

## 9. Konfiguration / Env (`.env.example`)

```
# Auth
RING_REFRESH_TOKEN=          # NUR erster Seed; danach gewinnt die persistierte Datei. Erst beim 1. Start erzeugen!
RING_CONTROL_CENTER_NAME=local-nvr

# Pfade (Container-intern; auf SATA gemountet)
DATA_MEDIA_DIR=/data/media
DATA_DB_PATH=/data/db/ring.db
TOKEN_FILE=/data/secrets/refresh-token

# Recording (M2)
CLIP_SECONDS=30              # Entscheidung B
RECORD_SNAPSHOT=false        # KORREKTUR 1: getSnapshot nur best-effort, default AUS

# Betrieb
LOG_LEVEL=info               # debug|info|warn|error
TZ=Europe/Berlin
DEVICE_FILTER=               # optional: nur bestimmte camera.id(s) (Komma-getrennt) oder Namens-Substring
```

---

## 10. Verify-Kriterien pro Milestone

**M1 — Worker + Token + Events**
- [ ] Worker startet mit gültigem Token **ohne** 2FA-Prompt.
- [ ] Startup-Log listet die erkannte(n) Kamera(s) (id + name).
- [ ] **M1-Gate #2 (HARTES NO-GO, KORREKTUR 2):** Bewegung vor **dieser 2K-Kamera** → Log `MOTION event received` + `events`-Row (`kind='motion'`, `recording_status='event_only'`) **in Echtzeit**. **Keine Events → Projekt mit dieser Hardware gestoppt.**
- [ ] **Restart-Test:** Token rotiert (Datei-Mtime ändert sich), dann `docker restart ring-worker` → läuft ohne Neu-Auth weiter.
- [ ] Keine Polling-/Re-Auth-Loops in Logs (Sichtprüfung).
- [ ] Bei totem Token: genau **ein** FATAL-Log + Exit, **kein** Retry-Sturm.

**M2 — Clip + Thumbnail + Metadaten**
- [ ] Echtes Event → `.mp4` auf SATA, abspielbar; Länge ≈ `CLIP_SECONDS` (30).
- [ ] **Thumbnail = erster Frame des Clips** (KORREKTUR 1); kein `getSnapshot`-Abhängigkeit.
- [ ] Aufnahme scheitert → Row bleibt `failed`, **nichts gelöscht**, evtl. kein Thumbnail.
- [ ] `cold_start_ms` gemessen & geloggt (Erwartung 3–8s) → reale Zahl dokumentiert.
- [ ] **Akku-Impact:** Batterie-% vor/nach X Aufnahmen über 24h notiert.
- [ ] Row: `label='unclassified'`.

**M3 — Dashboard (Next.js)**
- [ ] LAN-URL zeigt Timeline (neueste zuerst), Thumbnails.
- [ ] Klick → Clip-Playback im Browser.
- [ ] Liest DB **read-only**.

**M4 — deferred.** Nur Schema-Hook (`label`) verifiziert vorhanden.

---

## 11. Risiken & offene Punkte
- **2K-Modell-Risiko (KORREKTUR 2)** — primäres Go/No-Go. HA-Issue #155020 (Okt 2025) zeigte fehlende Motion-Events bei Outdoor Cam Plus 2K in `python-ring-doorbell`.
- **API-Bruch durch Ring** (inoffiziell) → fail-fast, Versions-Pin von `ring-client-api`, kein aggressives Verhalten.
- **Push-Wegschnappen / Control-Center-Token (KORREKTUR 3)** → SETUP-Troubleshooting.
- **Cold-Start frisst Event-Anfang** → Hardware-bedingt, akzeptiert.
- **Lockout-Risiko** → fail-fast statt Retry-Loop.
- **Motion Zones / Empfindlichkeit** → reiner **User-Konfig-Schritt in der Ring-App**, kein Code. Hinweis in SETUP.

---

## 12. Bau-Reihenfolge nach „Go"
1. **Korrekturen in PLAN.md** (dieses Dokument). ✅
2. Repo-Gerüst + `docs/` + `docker-compose.yml` + `.env.example`.
3. **M1** Worker (config, log, tokenStore, ringClient, subscriber, db) + Dockerfile.
4. **SETUP.md** idiotensicher (Token, Deploy, M1-Verify inkl. Gate #2 + Troubleshooting).
5. Du verifizierst M1 am echten Gerät → **Gate #2 Entscheidung**.
6. Erst bei „Ja": M2 (recorder + ffmpeg-1.-Frame-Thumbnail + cold_start-Messung).

## Quellen
- dgreif/ring (ring-client-api): https://github.com/dgreif/ring
- Maintainer zu Abo-freiem Aufnahme-Pfad: https://github.com/dgreif/ring/discussions/1403
- 2K-Modell-Risiko (Motion-Events fehlen): https://github.com/home-assistant/core/issues/155020
