# ring — Lokales, event-getriebenes NVR für Ring-Akku-Kameras & -Türklingeln

Selbst gehostetes, **lokales** und rein **event-getriebenes** Aufnahme- und
Benachrichtigungssystem für **Ring-Akku-Kameras und -Türklingeln**. Es ersetzt
die Ring-App/das Abo für die Grundfunktionen — **die Aufnahmen bleiben auf
deiner eigenen SATA-Platte**, kein bezahltes Ring-Abo nötig.

Läuft als Docker-Container auf einem **ZimaBlade / CasaOS** (oder jedem x86-Mini-PC
mit Docker, ohne GPU). Basiert auf der inoffiziellen
[`dgreif/ring`](https://github.com/dgreif/ring)-Bibliothek `ring-client-api`.

> Ein (kostenloses) **Ring-Konto + Ring-Cloud bleiben nötig** — die Hardware hat
> keine lokale API. Nur die Anwendungs-/Speicher-Ebene ist lokal. Es wird
> **niemals etwas auf Ring-Servern gelöscht** — alle Lösch-/Aufräum-Funktionen
> betreffen ausschließlich deine lokalen Dateien.

## 📦 Installation

➡️ **Komplette, anfängerfreundliche Schritt-für-Schritt-Anleitung:
[`docs/INSTALL.md`](docs/INSTALL.md)** — von „nichts" bis „laufendes System mit
Kameras, Türklingel-Alarm, Erkennung und Fernzugriff".

Ganz kurz (Details in der Anleitung):
```bash
git clone https://github.com/Sevinc-Lab/ring.git && cd ring
sudo mkdir -p /DATA/ring/{media,db,secrets}
cp .env.example .env            # Ring-Refresh-Token eintragen (Anleitung Schritt 1)
docker compose up -d --build
```
Dann das Dashboard im LAN öffnen: `http://<server-ip>:8080`.

---

## Was es alles kann

### 🎥 Aufnahme & Speicherung
- **Event-getrieben statt Dauerstream** — Akku-Geräte werden nur bei Bewegung
  oder Klingeln geweckt (kein Polling, akkuschonend).
- Pro Ereignis: **kurzer MP4-Clip** auf die SATA-Platte + **Erstbild-Thumbnail**
  + indizierte SQLite-Zeile (inkl. gemessener Kaltstart-Latenz).
- **Rotierendes Refresh-Token** wird sicher über Neustarts gespeichert
  (atomares Schreiben). Fail-fast bei totem Token (sperr-sicher).
- **Mehrere Kameras** gleichzeitig (z. B. Außenkamera **und** Türklingel).
- **Watchdog**: optionaler sauberer Neustart alle N Stunden, falls die
  Ring-Push-Verbindung „einschläft".

### 🔔 Türklingel (Doorbell)
- **Klingel-Erkennung**: Druck auf die Klingel wird als eigenes Ereignis erfasst
  (im Verlauf als „🔔 Klingel") und aufgenommen.
- **Lauter „Anruf" aufs Handy** über **ntfy** — klingelt auch bei gesperrtem
  Handy, mit **„Annehmen"-Button**.
- **Anruf-Screen im Dashboard**: Vollbild „Es klingelt!" mit Klingelton +
  Vibration, **Annehmen → Live-Bild + Freisprechen** (Mikro automatisch an).
- **Türbild** wird kurz nach dem Klingeln lautlos nachgereicht.
- Zusätzlich optional **Telegram-Push** „es klingelt".

### 🧠 KI-Objekterkennung (lokal, ohne Cloud)
- **YOLOv8s** auf der CPU (onnxruntime, kein PyTorch zur Laufzeit) — erkennt
  **alle ~80 COCO-Objekte**.
- **Primäres Label** per Priorität: **Person 🧍 / Hund 🐕 / Katze 🐈 / Auto 🚗**.
- **Alle anderen Objekte** (Laptop, Tasse …) werden als durchsuchbare
  **Objekt-Tags** gespeichert. Läuft **asynchron** auf den Clips.

### 🖥️ Dashboard (lokales Next.js, Tabs)
- **🎥 Dashboard-Tab** — Kamera-Übersicht als Kacheln: letzter Schnappschuss
  (statisch, weckt die Kamera nicht), **Akkustand**, Event-Anzahl. Klick → Live.
- **🕑 Verlauf-Tab** — Ereignisliste mit Wiedergabe im Browser. Filter **nach
  Klasse** („enthält"-Logik: Person **und** Hund → unter beiden), **nach
  Objekt-Tag** und **nach Kamera**; Seitenblättern.
- **Event-Detail** — Wiedergabe, Objekt-Tags, **🔲 Objekt-Overlay** (Kästchen
  übers Video), **⬇ Herunterladen**, **🗑 Löschen**, **🔄 Neu erkennen**.

### 👁️ Live & Interaktion
- **Live-Ansicht** per **WebRTC** (~1–2 s), Video direkt Kamera ↔ Browser.
  Akku-sicher: Auto-Stop bei Inaktivität / nach Maximaldauer.
- **🎤 Gegensprechen** (Two-Way Talk).
- **🔲 Live-Objekt-Overlay** — YOLO **im Browser** (WASM), Kästchen live übers
  Bild; läuft auf deinem Gerät, nicht auf dem Server.
- **⏺ Live-Mitschnitt** — die Live-Ansicht wird aufgezeichnet und landet im Verlauf.

### 📲 Benachrichtigungen
- **ntfy** (self-hosted) für lauten Türklingel-Alarm (siehe Türklingel).
- **Telegram** (über n8n) bei Person und/oder Klingeln — mit Link & Bild.

### 🚨 Gerätesteuerung (kapazitäts-geprüft)
- **Sirene** mit **Totmann-Schalter** (läuft nur, solange du zuschaust; harte
  Obergrenze), **Licht** — Knöpfe erscheinen nur, wenn die Kamera sie wirklich
  hat. **🔋 Akkustand** als Badge.

### 🗂️ Verwaltung
- **⬇ Herunterladen**, **🗑 Löschen** einzeln/mehrfach (**nur lokal**),
  **🧹 Auto-Aufräumen** (alte unwichtige Events weg, erkannte bleiben),
  **🔄 Neu erkennen** (Clips mit aktuellem Modell neu labeln).

### 🌐 Fernzugriff
- Über **Tailscale** (VPN) + **Tailscale Serve** für **HTTPS** — nötig fürs
  Mikrofon (sicherer Kontext) und fürs Klingeln von unterwegs. Kein
  Port-Forwarding, kein Cloud-Mirror.

---

## Architektur

Drei Docker-Container (+ optional ntfy & n8n), verbunden über das Compose-Netz:

| Container | Aufgabe |
|---|---|
| **ring-worker** | Auth + Token-Persistenz, Bewegungs-/Klingel-Events, Aufnahme, Live-/Geräte-Steuerung (HTTP-Kontrollserver), Retention, ntfy/Telegram-Push. Schreibt SQLite + Medien. |
| **ring-detector** | Python, YOLOv8s/onnxruntime. Liest neue Clips, schreibt Label + Objekt-Tags, stößt Telegram-Push an. |
| **ring-dashboard** | Next.js auf `:8080`. Liest SQLite **read-only**, proxyt Live-/Steuer-/Lösch-Befehle an den Worker, zeigt den Klingel-Anruf-Screen. |

- **SQLite** (WAL): Worker (und Detector für Labels) schreiben, Dashboard liest nur.
- **Medien** auf der **SATA-Platte** unter `<device_id>/<datum>/`.

➡️ **Installation:** [`docs/INSTALL.md`](docs/INSTALL.md)
➡️ **Design & Entscheidungen:** [`docs/PLAN.md`](docs/PLAN.md)
➡️ **Architektur-Übersicht:** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
➡️ **Telegram im Detail:** [`docs/M4c-SETUP-telegram.md`](docs/M4c-SETUP-telegram.md)

---

## Wichtige Einstellungen

In der `.env` (Worker) bzw. `docker-compose.yml` (Detector). Vollständige Liste
in [`docs/INSTALL.md`](docs/INSTALL.md).

| Variable | Wo | Bedeutung |
|---|---|---|
| `RING_REFRESH_TOKEN` | .env | Erstes Token (danach wird das gespeicherte genutzt) |
| `DEVICE_FILTER` | .env | Welche Kamera(s): Name/ID kommagetrennt; **leer = alle** |
| `CLIP_SECONDS` | .env | Länge eines Event-Clips (Standard 30) |
| `WORKER_RESTART_HOURS` | .env | Watchdog-Neustart (0 = aus) |
| `SIREN_GRACE_SECONDS` / `SIREN_MAX_SECONDS` | .env | Sirenen-Totmann-Schalter + harte Kappe |
| `DING_WEBHOOK_URL` | .env | Webhook bei Klingeln (z. B. n8n → Telegram) |
| `NTFY_URL` | .env | ntfy-Topic-URL für lauten Klingel-Alarm |
| `DASHBOARD_BASE_URL` | .env | Dashboard-URL (Tailscale-HTTPS) für „Annehmen"-Links + Bilder |
| `DETECT_CLASSES` | compose | Label-Priorität, z. B. `person,dog,cat,car` |
| `NOTIFY_LABELS` | compose | Welche Labels Telegram benachrichtigen |
| `NTFY_PRIORITY_<LABEL>` | compose | Eigene ntfy-Priorität pro Label (z. B. `NTFY_PRIORITY_PERSON=default`) → eigener Android-Kanal = eigener Klingelton |
| `MIN_CONFIDENCE` | compose | Erkennungs-Schwelle (Standard 0.40) |
| `RETENTION_ENABLED` / `RETENTION_DAYS` / `RETENTION_KEEP_LABELS` | .env | Auto-Aufräumen |

Detektor-Modell als Build-Schalter: `docker compose build --build-arg
YOLO_MODEL=yolov8n ring-detector` (zurück zum kleinen/schnellen Modell; Standard `yolov8s`).

---

## Repository-Aufbau

```
docs/                 INSTALL.md, PLAN.md, ARCHITECTURE.md, Telegram-Setup
docker-compose.yml    ring-worker + ring-detector + ring-dashboard
.env.example          Konfigurations-Vorlage
packages/worker/      TypeScript-Worker (Node 20 + ffmpeg)
packages/detector/    Python-Detektor (YOLOv8 / onnxruntime, CPU)
packages/dashboard/   Next.js-Dashboard (Tabs, Live, Verlauf, Klingel-Anruf)
```

## Lizenz

Für den privaten, lokalen Eigengebrauch. Nutzt die inoffizielle Ring-API —
verwende es verantwortungsvoll mit deinem eigenen Konto.
