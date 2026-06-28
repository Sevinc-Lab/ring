# ring — Lokales, event-getriebenes NVR für eine Ring-Akku-Kamera

Selbst gehostetes, **lokales** und rein **event-getriebenes** Aufnahmesystem für
eine Ring-Akku-Kamera (Ring Außenkamera Plus Akku, 2K). Es ersetzt die
Ring-App/das Abo für die Grundfunktionen — **die Aufnahmen bleiben auf deiner
eigenen SATA-Platte**, kein bezahltes Ring-Abo nötig.

Läuft als Docker-Container auf einem **ZimaBlade / CasaOS** (x86, Celeron, keine
GPU). Basiert auf der inoffiziellen
[`dgreif/ring`](https://github.com/dgreif/ring)-Bibliothek `ring-client-api`.

> Ein (kostenloses) **Ring-Konto + Ring-Cloud bleiben nötig** — die Hardware hat
> keine lokale API. Nur die Anwendungs-/Speicher-Ebene ist lokal. Es wird
> **niemals etwas auf Ring-Servern gelöscht** — alle Lösch-/Aufräum-Funktionen
> betreffen ausschließlich deine lokalen Dateien.

---

## Was es alles kann

### 🎥 Aufnahme & Speicherung
- **Event-getrieben statt Dauerstream** — die Akku-Kamera wird nur bei einer
  Bewegung geweckt (kein Polling, akkuschonend).
- Pro Bewegung: **kurzer MP4-Clip** auf die SATA-Platte + **Erstbild-Thumbnail**
  + indizierte SQLite-Zeile (inkl. gemessener Kaltstart-Latenz).
- **Rotierendes Refresh-Token wird sicher über Neustarts hinweg gespeichert**
  (atomares Schreiben). Fail-fast bei totem Token statt Re-Auth-Schleife
  (sperr-sicher).
- **Watchdog**: optionaler sauberer Neustart alle N Stunden, falls die
  Ring-Push-Verbindung „einschläft".

### 🧠 KI-Objekterkennung (lokal, ohne Cloud)
- **YOLOv8s** auf der CPU (onnxruntime, kein PyTorch zur Laufzeit) — erkennt
  **alle ~80 COCO-Objekte**.
- **Primäres Label** per Priorität: **Person 🧍 / Hund 🐕 / Katze 🐈 / Auto 🚗**.
- **Alle anderen erkannten Objekte** (Laptop, Tasse, Rucksack …) werden als
  durchsuchbare **Objekt-Tags** gespeichert.
- Läuft **asynchron** auf den aufgenommenen Clips — belastet das System nur
  kurz pro Event.

### 🖥️ Dashboard (lokales Next.js, Tabs)
- **🎥 Dashboard-Tab** — Kamera-Übersicht als Kacheln: letzter Schnappschuss
  (statisch, weckt die Kamera nicht), **Akkustand**, Event-Anzahl, „Zuletzt"-Zeit.
  Klick → Live-Ansicht der Kamera. Skaliert automatisch für mehrere Kameras.
- **🕑 Verlauf-Tab** — Ereignisliste mit Thumbnails und Wiedergabe im Browser
  (HTTP-Range/Springen). Filter:
  - **nach Klasse** (Person/Hund/Katze/Auto) — „enthält"-Logik: ein Clip mit
    Person **und** Hund erscheint unter **beiden** Filtern.
  - **nach Objekt-Tag** (Dropdown, z. B. „laptop", „bicycle" …).
  - **nach Kamera** (Dropdown).
  - Seitenblättern.
- **Event-Detailseite** — Wiedergabe, alle erkannten Objekt-Tags, Status/Metadaten.

### 📲 Benachrichtigungen
- **Telegram-Push bei Person** (über einen n8n-Webhook) mit Link zum Event,
  Clip und Thumbnail. Konfigurierbar, welche Labels benachrichtigen.

### 👁️ Live & Interaktion
- **Live-Ansicht** per **WebRTC** (~1–2 s Latenz), Video fließt direkt
  Kamera ↔ Browser. Akku-sicher: stoppt automatisch bei Inaktivität / nach
  Maximaldauer.
- **🎤 Gegensprechen** — dein Mikrofon auf den Kamera-Lautsprecher (Two-Way Talk).
- **🔲 Live-Objekt-Overlay** — YOLOv8n **im Browser** (onnxruntime-web/WASM)
  zeichnet Erkennungs-Kästchen live übers Bild; läuft auf deinem Gerät, **nicht**
  auf dem ZimaBlade.
- **⏺ Live-Mitschnitt** — die Live-Ansicht wird automatisch aufgezeichnet und
  landet als Event im Verlauf.

### 🚨 Gerätesteuerung (kapazitäts-geprüft)
- **Sirene** ein-/ausschalten — mit **Totmann-Schalter**: bleibt an, solange du
  zuschaust; schaltet automatisch ab, wenn dein Gerät nicht mehr erreichbar ist
  (Grace), und spätestens nach einer harten Obergrenze.
- **Licht** (falls die Kamera eins hat) — Knöpfe erscheinen nur, wenn die
  Hardware sie wirklich meldet, sonst ein ehrlicher Hinweis.
- **🔋 Akkustand** als Badge im Dashboard und in der Live-Ansicht.

### 🗂️ Verwaltung
- **⬇ Herunterladen** eines Clips aufs Gerät.
- **🗑 Löschen** einzeln oder **mehrfach** (Auswahl-Modus im Verlauf) —
  **nur lokal** (Clip + Thumbnail + DB-Zeile), Ring bleibt unberührt.
- **🧹 Auto-Aufräumen (Retention)** — alte, unwichtige Events (ohne Erkennung)
  werden nach X Tagen automatisch gelöscht; **erkannte Ereignisse
  (Person/Hund/Katze/Auto) bleiben erhalten**. Schützt die Platte vor dem
  Volllaufen. Abschaltbar.

### 🌐 Fernzugriff
- Über **Tailscale** (VPN) + Tailscale Serve für **HTTPS** erreichbar — nötig
  u. a. fürs Mikrofon (sicherer Kontext). Kein Port-Forwarding, kein Mirror.

---

## Architektur

Drei Docker-Container, verbunden über das Compose-Netz:

| Container | Aufgabe |
|---|---|
| **ring-worker** | Auth + Token-Persistenz, Bewegungs-Events, Aufnahme, Live-/Geräte-Steuerung (HTTP-Kontrollserver), Retention. Schreibt die SQLite-DB + Medien. |
| **ring-detector** | Python, YOLOv8s/onnxruntime. Liest neue Clips, schreibt Label + Objekt-Tags, stößt Benachrichtigungen an. |
| **ring-dashboard** | Next.js auf `:8080`. Liest die SQLite-DB **read-only**, proxyt Live-/Steuer-/Lösch-Befehle an den Worker. |

- **SQLite** im WAL-Modus: der Worker (und der Detektor für Labels) schreiben,
  das Dashboard liest nur. Pfade in der DB sind **relativ** zum Medien-Ordner.
- **Medien** liegen auf der **SATA-Platte** unter `<device_id>/<datum>/`.

➡️ **Einrichtung (Schritt für Schritt):** [`docs/SETUP.md`](docs/SETUP.md)
➡️ **Design & Entscheidungen:** [`docs/PLAN.md`](docs/PLAN.md)
➡️ **Architektur-Übersicht:** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
➡️ **Telegram einrichten:** [`docs/M4c-SETUP-telegram.md`](docs/M4c-SETUP-telegram.md)

---

## Schnellstart

```bash
git clone https://github.com/Sevinc-Lab/ring.git && cd ring
sudo mkdir -p /DATA/ring/{media,db,secrets}
cp .env.example .env            # dann das ring-auth-cli Refresh-Token eintragen
docker compose up -d --build
docker compose logs -f ring-worker
```

Danach das Dashboard im LAN öffnen: `http://<zimablade-ip>:8080`.

> Tipp gegen volllaufenden Build-Cache: einmalig in `/etc/docker/daemon.json`
> `{"builder":{"gc":{"enabled":true,"defaultKeepStorage":"4GB"}}}` setzen und
> `sudo systemctl restart docker`.

---

## Wichtige Einstellungen

In der `.env` bzw. `docker-compose.yml`:

| Variable | Bedeutung |
|---|---|
| `RING_REFRESH_TOKEN` | Erstes Token (danach wird das gespeicherte verwendet) |
| `DEVICE_FILTER` | Welche Kamera(s) überwacht werden (Name/ID, kommagetrennt; leer = alle) |
| `CLIP_SECONDS` | Länge eines Event-Clips (Standard 30) |
| `WORKER_RESTART_HOURS` | Watchdog-Neustart-Intervall (0 = aus) |
| `LIVE_MAX_SECONDS`, `LIVE_IDLE_TIMEOUT_SECONDS` | Auto-Stop der Live-Ansicht |
| `SIREN_GRACE_SECONDS`, `SIREN_MAX_SECONDS` | Totmann-Schalter + harte Kappe der Sirene |
| `DETECT_CLASSES` | Label-Priorität, z. B. `person,dog,cat,car` |
| `NOTIFY_LABELS` | Welche Labels Telegram benachrichtigen (Standard `person`) |
| `MIN_CONFIDENCE` | Erkennungs-Schwelle (Standard 0.40) |
| `RETENTION_ENABLED`, `RETENTION_DAYS`, `RETENTION_KEEP_LABELS` | Auto-Aufräumen |

Das **Detektor-Modell** ist ein Build-Schalter:
`docker compose build --build-arg YOLO_MODEL=yolov8n ring-detector` (zurück zum
kleinen/schnellen Modell). Standard ist `yolov8s`.

---

## Repository-Aufbau

```
docs/                 PLAN.md, SETUP.md, ARCHITECTURE.md, Telegram-Setup
docker-compose.yml    ring-worker + ring-detector + ring-dashboard
.env.example          Konfigurations-Vorlage
packages/worker/      TypeScript-Worker (Node 20 + ffmpeg)
packages/detector/    Python-Detektor (YOLOv8 / onnxruntime, CPU)
packages/dashboard/   Next.js-Dashboard (Tabs, Live, Verlauf, Steuerung)
```

---

## Lizenz

Siehe Repository. Nur für den privaten, lokalen Eigengebrauch gedacht; nutzt die
inoffizielle Ring-API — verwende es verantwortungsvoll mit deinem eigenen Konto.
