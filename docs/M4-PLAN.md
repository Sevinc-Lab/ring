# PLAN — M4: Detection + gezielte Notifications

> Status: **freigegeben** für **M4a** (nur Detection). Korrekturen des Architekten
> sind unten als `KORREKTUR M4-x` markiert und eingearbeitet.

## 0. Leitprinzipien (unverändert)
- **Nachgelagert & entkoppelt:** Detection läuft auf dem **fertigen Clip**, nie im
  Aufnahme-/Stream-Pfad. **Kein Einfluss auf Akku oder Aufnahme.**
- **Nur labeln, nie löschen:** M4 schreibt **ausschließlich** `label`/`label_meta`.
- **Andockbar:** nutzt das reservierte `label`-Feld; Worker bleibt unangetastet.
- **Celeron, keine GPU:** CPU-Inferenz, aber event-getrieben & selten → unkritisch.

## 1. Finale Entscheidungen (A–E)
| | Entscheidung |
|---|---|
| **A — Engine** | **Embedded YOLOv8n** (COCO, CPU, ONNX via onnxruntime) im Detector. **Kein** CodeProject.AI (dessen einziger Mehrwert wären Gesichter — out of scope). |
| **B — Klassen** | **Person + Paket**, aber siehe **KORREKTUR M4-1**: M4a = **nur `person`**; `parcel` braucht ein Custom-Modell und ist ein separater Unter-Task (M4d). |
| **C — Notifications** | **Webhook an n8n**; Kanal später in n8n. In M4a nur **vorbereitet/gestubbt**, echtes Feuern erst **M4c**. |
| **D — Sprache** | **Python**-Detector (eigener Container, dockt **nur über SQLite** an). |
| **E — Reihenfolge** | **M4a → M4b → M4c**, je eigener PR. |

## 2. KORREKTUREN (Pflicht)

### KORREKTUR M4-1 — „Paket" ist KEINE Standard-COCO-Klasse
Stock-YOLOv8n erkennt zuverlässig **`person` (COCO 0)**, **nicht** `parcel`/`package`/Karton.
- **M4a liefert Person-Detection voll funktionsfähig** (Default-Modell, frei).
- **Paket-Detection** = **separat markierter Unter-Task (M4d)**, braucht ein
  Custom-/Community-Modell + Test auf echten 2K-Frames. **Nicht** als „out of the box".
- **Aktive `label`-Werte vorerst:** `person` | `none` | `error`.
  `parcel` im Label-Enum **vorgesehen**, aber erst aktiv, wenn ein Paket-Modell drin ist.
- **Schema (`label`/`label_meta`) bleibt unverändert** → Paket später nachrüstbar.

### KORREKTUR M4-2 — Frames über den GESAMTEN Clip sampeln
Frames **gleichmäßig über die komplette Clip-Dauer** verteilen (nicht nur Anfang).
`FRAMES_PER_CLIP` konfigurierbar (**Default 5**). Fängt den Cold-Start automatisch
ab → **keine feste Cold-Start-Zahl** nötig.

## 3. Harte Invarianten (unverändert)
- Detector schreibt **NUR** `label`/`label_meta`. **Worker bleibt völlig unangetastet.**
- **Nie löschen, nur labeln.** Query **ausschließlich** `WHERE recording_status='recorded'
  AND label='unclassified'`. `event_only`/`failed`-Rows werden **nicht** angefasst.
- **Detector aus → Worker nimmt normal weiter auf** (Entkopplung; Verify-Kriterium).
- **SQLite:** Detector als **Zweit-Writer nur für `label`**, WAL + `busy_timeout`.

## 4. Architektur & Datenfluss (M4a)
```
ring-detector (Python, eigener Container)
  loop alle POLL_SECONDS:
    rows = SELECT … WHERE recording_status='recorded' AND label='unclassified'
    für jeden Clip:
      frames = ffmpeg: FRAMES_PER_CLIP Frames gleichmäßig über die ganze Dauer
      dets   = YOLOv8n(person) je Frame  (onnxruntime, CPU)
      label  = 'person' wenn ein Frame ≥ MIN_CONFIDENCE Person zeigt, sonst 'none'
               ('error' wenn ffmpeg/Inferenz scheitert)
      label_meta = JSON{ detected, max_conf, frames[], boxes, model, engine, cpu_ms }
      UPDATE events SET label=…, label_meta=… WHERE id=?        ← nur diese Spalten
      (Notification: Payload bauen, in M4a NICHT feuern — Stub, siehe §6)
    CPU-Zeit pro Clip messen & loggen
```
- **Modell:** `yolov8n.onnx` wird **im Docker-Build per `ultralytics` exportiert**
  (Torch nur im Build-Stage); das Runtime-Image enthält **nur** onnxruntime + das
  `.onnx` → schlank, kein Torch zur Laufzeit, offline nach dem Build.

## 5. Config / Env (`ring-detector`)
```
DATA_DB_PATH=/data/db/ring.db
DATA_MEDIA_DIR=/data/media        # ro
MODEL_PATH=/app/model/yolov8n.onnx
POLL_SECONDS=5
FRAMES_PER_CLIP=5                 # KORREKTUR M4-2
MIN_CONFIDENCE=0.40
DETECT_CLASSES=person            # M4a: nur person aktiv
N8N_WEBHOOK_URL=                 # M4c; in M4a ungenutzt
NOTIFY_ENABLED=false             # M4a: Stub aus
LOG_LEVEL=info
```

## 6. Notification (C) — in M4a nur vorbereitet
Channel-agnostische Webhook-Funktion mit Payload
`{ label, device_id, device_name, started_at, clip_path, thumb_path, scores }`.
In M4a **gestubbt**: gebaut, aber nur geloggt/optional — **echtes Feuern erst M4c**
(dort richte ich dir auch den n8n-Flow Schritt für Schritt ein).

## 7. Container-Layout & Compose
```
ring-worker      (unverändert)
ring-dashboard   (unverändert; Label-Badge/Filter erst M4b)
ring-detector    (neu: Poll → ffmpeg-Frames → YOLOv8n → label/label_meta)
```
- Detector mountet `/DATA/ring/db` (rw, nur `label`) + `/DATA/ring/media` (**ro**).
- `restart: unless-stopped`.

## 8. Repo-Struktur (Ergänzung)
```
packages/detector/
  Dockerfile            # multi-stage: build exportiert onnx; runtime lean
  requirements.txt
  src/
    config.py           # Env (Defaults)
    db.py               # poll unclassified + update label (sqlite3, WAL, busy_timeout)
    frames.py           # ffmpeg/ffprobe: N Frames über die ganze Dauer
    detect.py           # YOLOv8n onnxruntime: letterbox, infer, NMS, person-Filter
    notify.py           # channel-agnostischer Webhook-Payload (M4a: Stub)
    main.py             # Loop, CPU-Messung, graceful shutdown
```

## 9. Scope M4a (NUR das)
Python-Detector-Container (YOLOv8n CPU) · Poll → Frame-Sampling → **Person**-Detection
→ `label`/`label_meta`-Update · Compose-Eintrag `ring-detector`.
**KEIN** Dashboard-Label (= M4b) · **KEINE** echte Notification (= M4c) · **KEIN** Paket (= M4d).

## 10. Verify-Kriterien (M4a)
- [ ] Neuer `recorded`-Clip wird automatisch erkannt (Poll), gelabelt, `label_meta` gefüllt.
- [ ] Person vor der Kamera → `label='person'`; leere Szene → `none`; **Clip bleibt** in beiden Fällen.
- [ ] `event_only`/`failed`-Rows werden **nicht** angefasst.
- [ ] **Detector aus → Worker nimmt unverändert auf** (Entkopplung bewiesen).
- [ ] **CPU-Last pro Clip gemessen/geloggt** (Erwartung: wenige Sekunden auf dem Celeron).
- [ ] Worker-Code unverändert; Detector schreibt nur `label`/`label_meta`.

## 11. Risiken & offene Punkte
- **Modellgüte auf 2K-/Nachtsicht-Frames** — erst am echten Material messbar; `MIN_CONFIDENCE` justierbar.
- **Build-Schwere:** `ultralytics`/Torch nur im Build-Stage; Runtime bleibt schlank. Build dauert länger.
- **Zwei SQLite-Writer** (Worker + Detector) — WAL + `busy_timeout`, niedrige Frequenz, unkritisch.
- **`parcel`** bewusst vertagt (M4d) — eigenes Modell, eigener PR.
