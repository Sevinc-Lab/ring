# Installation & Einrichtung — Schritt für Schritt

Diese Anleitung bringt das **komplette System** zum Laufen: Aufnahme bei
Bewegung/Klingeln, lokale Objekterkennung, ein Web-Dashboard, Live-Bild mit
Gegensprechen, Türklingel-Alarm aufs Handy und Fernzugriff.

Sie ist für **Einsteiger** gedacht — jeder Befehl ist zum Kopieren. Du brauchst
nur **SSH/Terminal-Zugang** zu deinem Server.

**Inhalt**
1. [Voraussetzungen](#0-voraussetzungen)
2. [Refresh-Token erzeugen](#1-refresh-token-erzeugen-2fa)
3. [Projekt holen, konfigurieren, starten](#2-projekt-holen-konfigurieren-starten)
4. [Erste Prüfung](#3-erste-pruefung)
5. [Mehrere Kameras / Türklingel](#4-mehrere-kameras--tuerklingel)
6. [Objekterkennung](#5-objekterkennung)
7. [Fernzugriff + HTTPS (Tailscale)](#6-fernzugriff--https-tailscale)
8. [Telegram-Benachrichtigungen (n8n)](#7-telegram-benachrichtigungen-n8n)
9. [Türklingel-Alarm aufs Handy (ntfy)](#8-tuerklingel-alarm-aufs-handy-ntfy)
10. [Auto-Aufräumen](#9-auto-aufraeumen-retention)
11. [Wartung & Updates](#10-wartung--updates)
12. [Konfigurations-Referenz](#11-konfigurations-referenz)
13. [Fehlerbehebung](#12-fehlerbehebung)

---

## 0. Voraussetzungen

- **Hardware:** ein x86-Mini-PC mit Docker — getestet auf **ZimaBlade 7700**
  (Quad-Core Celeron, 16 GB RAM-Slot) mit **CasaOS** (bringt Docker mit). Keine
  GPU nötig.
- **Speicher:** eine **SATA-Platte/SSD** für die Aufnahmen (hier unter `/DATA`).
- **Ring-Konto** + mindestens eine Kamera/Türklingel, die in der **Ring-App**
  bereits eingerichtet und online ist. Dein Handy für den **2FA-Code**.
- **SSH/Terminal**-Zugang zum Server und Internet.

> **Hinweis zur Hardware-Eignung:** Akku-Kameras der neuesten 2K-Generation
> liefern über die inoffizielle API normalerweise Motion-Events — bestätigt mit
> „Ring Außenkamera Plus Akku" und „Battery Doorbell Plus (2. Gen)". Sollte bei
> dir Schritt 3 **keine** Events zeigen, liegt das an der Hardware/API, nicht an
> dieser Software.

Docker prüfen:
```bash
docker version
```
Mehrere Zeilen „Client"/„Server" = ok. „command not found"/„permission denied" →
CasaOS/Docker nicht bereit, oder allen `docker`-Befehlen `sudo` voranstellen.

---

## 1. Refresh-Token erzeugen (2FA)

Der Worker meldet sich bei Ring mit einem **Refresh-Token** an (nicht mit
E-Mail/Passwort). Den erzeugst du **einmalig** mit `ring-auth-cli` in einem
Wegwerf-Container (kein Node.js nötig).

> **Erst jetzt erzeugen, direkt vor dem ersten Start** — Tokens „verbrauchen" sich.

```bash
docker run -it --rm node:20-alpine npx -y -p ring-client-api ring-auth-cli
```
Der Assistent fragt nacheinander:
1. **Email:** deine Ring-E-Mail → Enter
2. **Password:** dein Ring-Passwort → Enter (Eingabe unsichtbar, normal)
3. **2FA / code:** den Code per SMS/App → Enter

Danach kommt eine **lange Zeichenkette** — dein Refresh-Token. **Kopiere sie
komplett** (ohne Leerzeichen). Du fügst sie in Schritt 2 ein.

**Fehler?**
- „Invalid 2FA code" → abgelaufen, Befehl neu starten, neuen Code abwarten.
- „too many requests" / Sperre → **10–15 Min warten**, nicht in Schleife
  wiederholen (schützt dein Konto vor Sperre).

---

## 2. Projekt holen, konfigurieren, starten

**2a) Projekt holen**
```bash
cd ~
git clone https://github.com/Sevinc-Lab/ring.git
cd ring
```

**2b) Datenordner auf der SATA-Platte**
```bash
sudo mkdir -p /DATA/ring/media /DATA/ring/db /DATA/ring/secrets
```
> Hängt deine Platte nicht unter `/DATA`? Pfad mit `df -h` finden, Ordner dort
> anlegen und in `docker-compose.yml` die linken Pfade (`/DATA/ring/...`) anpassen.

**2c) Konfig anlegen + Token eintragen**
```bash
cp .env.example .env
nano .env
```
In der Zeile `RING_REFRESH_TOKEN=` direkt dahinter (ohne Leerzeichen) deinen
Token einfügen. `TZ` bei Bedarf auf deine Zeitzone. Speichern: `Strg`+`O`,
`Enter`, `Strg`+`X`.

> **Eine oder mehrere Kameras?** `DEVICE_FILTER=` **leer lassen** überwacht
> **alle** Kameras deines Kontos (empfohlen, wenn du alle willst). Willst du nur
> bestimmte, trage Namen/IDs kommagetrennt ein (z. B. `Garten,Haustür`).

**2d) Bauen + starten**
```bash
docker compose up -d --build
```
Der erste Build dauert einige Minuten (lädt u. a. das KI-Modell). Am Ende
sollten alle Container `Started`/`running` sein.

---

## 3. Erste Prüfung

**Welche Kameras wurden gefunden?**
```bash
docker compose logs --tail=50 ring-worker | grep -E "Discovered camera|Listening"
```
→ Pro Kamera eine „Discovered camera"-Zeile + am Ende `✅ Listening for motion events`.

**Dashboard öffnen:** im Browser im selben Netz `http://<server-ip>:8080`.
Server-IP herausfinden: `hostname -I | awk '{print $1}'`.

**Test:** vor die Kamera gehen / klingeln → nach ein paar Sekunden erscheint im
**🕑 Verlauf** ein Event mit Vorschaubild.

> Kommen **keine** Events (auch nach echter Bewegung)? Siehe
> [Fehlerbehebung](#12-fehlerbehebung).

---

## 4. Mehrere Kameras / Türklingel

Der Worker liest die Kameraliste **nur beim Start**. Wenn du in der Ring-App
**eine neue Kamera/Türklingel hinzufügst**:

1. Sicherstellen, dass `DEVICE_FILTER` sie zulässt (leer = alle, oder Name
   ergänzen).
2. Worker **neu starten**, damit er sie abfragt:
   ```bash
   docker compose restart ring-worker
   docker compose logs --tail=80 ring-worker | grep "Discovered camera"
   ```
   → jetzt sollte die neue Kamera/Türklingel mit auftauchen.

Im **🎥 Dashboard-Tab** erscheint sie als eigene Kachel; der **Kamera-Filter** im
Verlauf trennt die Ereignisse.

> ⚠️ Jede abonnierte **Akku-Kamera** kostet etwas Akku — nur die abonnieren, die
> du wirklich brauchst.

---

## 5. Objekterkennung

Der **ring-detector** läuft automatisch mit. Er verarbeitet aufgenommene Clips,
vergibt ein **Label** (Person/Hund/Katze/Auto) und speichert **alle erkannten
Objekte** als Filter-Tags. Einstellungen stehen in `docker-compose.yml` beim
`ring-detector`:

- `DETECT_CLASSES=person,dog,cat,car` — Reihenfolge = **Label-Priorität**.
- `MIN_CONFIDENCE=0.40` — Schwelle; niedriger = mehr Treffer, mehr Fehlalarme.
- `NOTIFY_LABELS=person` — welche Labels Telegram auslösen.

**Modell wechseln** (Genauigkeit ↔ Tempo): Standard ist `yolov8s`. Zurück zum
kleinen, schnellen Modell:
```bash
docker compose build --build-arg YOLO_MODEL=yolov8n ring-detector
docker compose up -d ring-detector
```

**Alte Aufnahmen neu erkennen** (z. B. nach Modell-/Klassenwechsel): im Verlauf
**🔄 Alle neu erkennen** oder pro Event **🔄 Neu erkennen**.

---

## 6. Fernzugriff + HTTPS (Tailscale)

Für **Zugriff von unterwegs** und vor allem fürs **Mikrofon/Gegensprechen**
(Browser erlauben das Mikro nur über **HTTPS**) richte **Tailscale** ein:

1. **Tailscale** auf dem Server installieren und einloggen (kostenloses Konto):
   <https://tailscale.com/download> → `tailscale up`.
2. **Tailscale-App** auf dem Handy/Laptop installieren, gleiches Konto.
3. **HTTPS fürs Dashboard** per Tailscale Serve:
   ```bash
   sudo tailscale serve --bg 8080
   ```
   Danach ist das Dashboard erreichbar unter deiner MagicDNS-Adresse, z. B.
   `https://<dein-host>.tailXXXX.ts.net`.
4. Diese HTTPS-Adresse benutzt du für Live + Gegensprechen vom Handy. Notiere
   sie — du brauchst sie gleich für `DASHBOARD_BASE_URL`.

> Deine **Tailscale-IP** (Format `100.x.y.z`) zeigt `tailscale ip -4`. Die
> brauchst du, wenn Dienste (n8n, ntfy) sich gegenseitig erreichen sollen.

---

## 7. Telegram-Benachrichtigungen (n8n)

Optional: Push bei **Person** und/oder **Klingeln** via Telegram. Voraussetzung
ist eine laufende **n8n**-Instanz (CasaOS-App, Standardport 5678).

Die ausführliche Anleitung (Bot anlegen, Chat-ID, n8n-Flow) steht in
[`docs/M4c-SETUP-telegram.md`](M4c-SETUP-telegram.md). Kurzfassung:

1. Telegram-**Bot-Token** (@BotFather) und **Chat-ID** (@userinfobot) holen.
2. In n8n einen Workflow **Webhook → Telegram** bauen (Pfad z. B. `ring-person`),
   aktivieren.
3. **Person-Alarm** (Detector): in `docker-compose.yml` beim `ring-detector`
   `N8N_WEBHOOK_URL` auf die Webhook-URL setzen (mit Server-/Tailscale-IP, **nicht**
   `localhost`) und `DASHBOARD_BASE_URL` auf deine `https://…ts.net`-Adresse.
   Dann `docker compose up -d --build ring-detector`.
4. **Klingel-Push** (Worker): zweiten Webhook `ring-ding` bauen und in die `.env`
   `DING_WEBHOOK_URL=http://<ip>:5678/webhook/ring-ding` eintragen, dann
   `docker compose up -d ring-worker`.

---

## 8. Türklingel-Alarm aufs Handy (ntfy)

Für ein **lautes Klingeln** auf dem Handy (auch bei gesperrtem Bildschirm) mit
**„Annehmen"-Button** und **Türbild**. **ntfy** ist kostenlos & open source und
läuft selbst gehostet auf deinem Server.

**8a) ntfy-Server starten** (Tailscale-IP einsetzen, Format `100.x.y.z`):
```bash
docker run -d --name ntfy --restart unless-stopped \
  -p 8090:80 \
  -v /DATA/ntfy:/var/cache/ntfy \
  binwiederhier/ntfy serve --base-url http://<TAILSCALE-IP>:8090
```
Prüfen: `curl -s http://<TAILSCALE-IP>:8090/v1/health` → `{"healthy":true}`.

**8b) ntfy-App** (Android/iOS, Entwickler **Philipp C. Heckel**, Paket
`io.heckel.ntfy`) installieren → **Subscribe to topic** → **Use another server**:
`http://<TAILSCALE-IP>:8090` → Topic frei wählen (schwer zu erraten, z. B.
`haustuer-7k2p`; das ist dein „Passwort").

**8c) Laut stellen** (wichtig, sonst nur leiser Pieps):
- ntfy-App → Settings → **Instant delivery** an (sofortige Zustellung).
- Android: Einstellungen → Apps → ntfy → Benachrichtigungen → Kanal
  **„Max priority"** → Ton = langer **Klingelton/Alarm**, Wichtigkeit „Dringend".
- Bei MIUI/Xiaomi: ntfy **Autostart** erlauben + **Akku: keine Einschränkungen**.
- Test: `curl -H "Priority: urgent" -H "Tags: bell" -d "Test 🔔" http://<TAILSCALE-IP>:8090/<topic>`

**8d) Worker verbinden** — in die `.env`:
```
NTFY_URL=http://<TAILSCALE-IP>:8090/<topic>
DASHBOARD_BASE_URL=https://<dein-host>.tailXXXX.ts.net
```
Dann `docker compose up -d --build ring-worker`.

Ab jetzt beim Klingeln: lauter ntfy-Alarm (1×) + „Annehmen" (→ Live +
Freisprechen) + kurz darauf lautlos das Türbild. Zusätzlich klingelt das
**offene Dashboard** (Anruf-Screen mit Ton).

> Hinweis: Ein echter „Anruf-Klingelton, der läuft bis du rangehst", bei
> **komplett geschlossener** App bräuchte eine native App — ntfy spielt den Ton
> einmal (wähl einen langen Ton). Der durchgehende Klingelton kommt vom **offenen
> Dashboard**.

---

## 9. Auto-Aufräumen (Retention)

Damit die Platte nicht volläuft, löscht der Worker **alte, unwichtige** Events
automatisch. **Erkannte** Ereignisse (Person/Hund/Katze/Auto) bleiben erhalten.
Standardmäßig **an**. In der `.env`:
```
RETENTION_ENABLED=true          # false = aus
RETENTION_DAYS=30               # alles Unwichtige älter als X Tage wird gelöscht
RETENTION_KEEP_LABELS=person,dog,cat,car   # diese werden nie auto-gelöscht
```
Manuell löschen: im Verlauf **☑ Auswählen** → mehrere markieren → **🗑 Löschen**,
oder einzeln auf der Event-Seite. **Immer nur lokal** — Ring bleibt unberührt.

---

## 10. Wartung & Updates

**Update einspielen:**
```bash
cd ~/ring
git pull --no-rebase
docker compose up -d --build
```
(Nur ein Teil geändert? `… --build ring-worker` bzw. `ring-dashboard` /
`ring-detector`.)

**Docker-Build-Cache begrenzen** (sonst läuft die System-Platte mit der Zeit
voll). Einmalig:
```bash
sudo tee /etc/docker/daemon.json >/dev/null <<'EOF'
{ "builder": { "gc": { "enabled": true, "defaultKeepStorage": "4GB" } } }
EOF
sudo systemctl restart docker
```

**Platte voll?** Schnell aufräumen: `docker builder prune -f`.

---

## 11. Konfigurations-Referenz

**Worker (`.env`):**

| Variable | Bedeutung |
|---|---|
| `RING_REFRESH_TOKEN` | Erstes Token; danach wird das rotierte gespeicherte genutzt |
| `RING_CONTROL_CENTER_NAME` | Anzeigename im Ring Control Center |
| `DEVICE_FILTER` | Kamera(s): Name/ID kommagetrennt; **leer = alle** |
| `CLIP_SECONDS` | Länge eines Event-Clips (Standard 30) |
| `WORKER_RESTART_HOURS` | Watchdog-Neustart-Intervall (0 = aus) |
| `LIVE_MAX_SECONDS`, `LIVE_IDLE_TIMEOUT_SECONDS` | Auto-Stop der Live-Ansicht |
| `SIREN_GRACE_SECONDS`, `SIREN_MAX_SECONDS` | Sirenen-Totmann-Schalter + harte Kappe |
| `DING_WEBHOOK_URL` | Webhook bei Klingeln (n8n → Telegram) |
| `NTFY_URL` | ntfy-Topic-URL für lauten Klingel-Alarm |
| `DASHBOARD_BASE_URL` | Dashboard-URL (Tailscale-HTTPS) für Links/Bilder |
| `RETENTION_ENABLED`, `RETENTION_DAYS`, `RETENTION_KEEP_LABELS`, `RETENTION_SWEEP_HOURS` | Auto-Aufräumen |

**Detector (`docker-compose.yml` → `ring-detector` → `environment`):**

| Variable | Bedeutung |
|---|---|
| `DETECT_CLASSES` | Label-Priorität, z. B. `person,dog,cat,car` |
| `MIN_CONFIDENCE` | Erkennungs-Schwelle (Standard 0.40) |
| `NOTIFY_LABELS` | Welche Labels Telegram benachrichtigen |
| `NOTIFY_ENABLED`, `N8N_WEBHOOK_URL`, `DASHBOARD_BASE_URL` | Telegram-Push (Person) |
| `FRAMES_PER_CLIP`, `POLL_SECONDS` | wie viele Frames/Clip, Poll-Takt |

Build-Schalter Modell: `--build-arg YOLO_MODEL=yolov8n|yolov8s` (Standard `yolov8s`).

---

## 12. Fehlerbehebung

**Keine Events, obwohl du dich bewegst/klingelst**
- Log prüfen: `docker compose logs -f ring-worker` — erscheint „MOTION event
  received" / „DOORBELL pressed"? Wenn ja, ist der Worker ok; fehlende Events
  liegen an Ring-Einstellungen (Bewegungszonen/Empfindlichkeit in der App).
- Token tot? Log zeigt dann eine fatale Auth-Meldung → Token neu erzeugen
  (Schritt 1), in `.env` eintragen, `docker compose up -d ring-worker`.

**Neue Kamera taucht nicht auf** → Worker neu starten (`docker compose restart
ring-worker`); `DEVICE_FILTER` prüfen.

**Mikro/„Kein Mikro nicht erlaubt"** → Browser braucht **HTTPS**; übers
Tailscale-`https://…ts.net` öffnen (Schritt 6), nicht über `http://…:8080`.

**ntfy kommt leise/gar nicht** → Schritt 8c (Instant delivery, „Max
priority"-Ton, MIUI-Akku-Freigaben). Erreichbarkeit: `curl …/v1/health`.

**Webhook „hängt"/Timeout** → falsche IP/Port. Dienste untereinander über die
**Tailscale-/LAN-IP** ansprechen, **nicht** `localhost` (das zeigt im Container
auf sich selbst). HTTPS-`ts.net` ist nur fürs Dashboard (Port 443→8080), **nicht**
für n8n/ntfy.

**Platte voll / Build bricht ab** → `docker builder prune -f`, dann Cache-Limit
setzen (Schritt 10).

**„docker compose: command not found"** → ältere Version: `docker-compose`
(mit Bindestrich) verwenden.
