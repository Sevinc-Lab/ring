# SETUP — Schritt für Schritt (für absolute Anfänger)

Diese Anleitung bringt das **M1**-System zum Laufen: den Ring-Worker, der echte
**Motion-Events** deiner Kamera empfängt und in einer lokalen Datenbank speichert.
Aufnahmen (mp4) kommen erst in M2 — jetzt geht es nur darum zu **beweisen, dass
Events ankommen**.

**Annahme:** Du kannst dich per **SSH/Terminal** auf deinem ZimaBlade einloggen
und Befehle eintippen. Mehr nicht. Jeder Schritt unten ist zum Kopieren.

> **Wichtiger Hinweis vorab — Go/No-Go:** Deine Kamera ist die **neueste 2K-Generation
> (Ring Außenkamera Plus Akku)**. Bei genau dieser Generation gab es zuletzt Berichte,
> dass Motion-Events über die inoffizielle API **nicht** ankommen. Schritt 3 (Verify)
> ist deshalb ein **hartes Test-Tor**: Kommen keine Events an, ist das Projekt mit
> dieser Hardware blockiert — das ist dann kein Fehler von dir.

---

## Was du brauchst
- Dein ZimaBlade mit CasaOS (Docker ist darin enthalten).
- SSH-Zugang (Terminal).
- Deine **Ring-Konto-Zugangsdaten** (E-Mail + Passwort) und dein Handy für den
  **2FA-Code** (SMS oder Authenticator).
- Internet am ZimaBlade.

---

## Schritt 0 — Ins Terminal einloggen und prüfen, dass Docker läuft

Logge dich per SSH auf dem ZimaBlade ein. Dann tippe:

```bash
docker version
```

**Was das tut:** zeigt die installierte Docker-Version.
**Was du erwarten solltest:** mehrere Zeilen mit „Client" und „Server".
**Wenn Fehler** („command not found" oder „permission denied"): Docker/CasaOS ist
nicht bereit. Stelle sicher, dass CasaOS läuft, oder stelle den Befehlen ein
`sudo` voran (z.B. `sudo docker version`). Wenn du `sudo` brauchst, brauchst du es
bei **allen** `docker`-Befehlen unten.

---

## Schritt 1 — Refresh-Token erzeugen (2FA)

Der Worker meldet sich bei Ring mit einem **Refresh-Token** an (nicht mit
E-Mail/Passwort). Den Token erzeugst du **einmalig** mit dem Tool `ring-auth-cli`.
Damit du dafür kein Node.js installieren musst, läuft es in einem Wegwerf-Container.

> **Erst jetzt erzeugen — nicht früher.** Tokens „verbrauchen" sich; erzeuge ihn
> direkt vor dem ersten Start.

Tippe:

```bash
docker run -it --rm node:20-alpine npx -y -p ring-client-api ring-auth-cli
```

**Was das tut:** lädt kurz das Tool herunter und startet den Login-Assistenten.
**Was du erwarten solltest — der Assistent fragt nacheinander:**
1. **Email:** deine Ring-E-Mail → Enter
2. **Password:** dein Ring-Passwort → Enter (Eingabe ist unsichtbar, das ist normal)
3. **2FA / code:** den Code, den Ring dir per SMS/App schickt → Enter

Danach gibt das Tool eine **lange Zeichenkette** aus — das ist dein Refresh-Token,
z.B.:

```
Successfully authenticated with Ring. Your refresh token is:

eyJhbGciOi...sehr lang...XYZ
```

**Kopiere diese Zeichenkette** (die ganze, ohne Leerzeichen drumherum) an einen
sicheren Ort — du fügst sie gleich in Schritt 2 ein.

**Wenn Fehler:**
- „Invalid 2FA code" → Code war abgelaufen/falsch. Befehl erneut starten, neuen
  Code abwarten.
- „too many requests" / Sperre → **kurz warten** (10–15 Min), nicht in Schleife
  wiederholen. Mehrfaches schnelles Wiederholen kann dein Konto kurzzeitig sperren.
- Hängt ewig ohne Frage → mit `Strg`+`C` abbrechen und Befehl neu starten.

---

## Schritt 2 — Projekt holen, Ordner anlegen, `.env` ausfüllen, starten

### 2a) Projekt auf das ZimaBlade holen

```bash
cd ~
git clone https://github.com/Sevinc-Lab/ring.git
cd ring
```

**Was das tut:** lädt dieses Projekt herunter und wechselt hinein.
**Erwartung:** ein Ordner `ring` entsteht, du bist danach darin.
**Wenn `git` fehlt:** `sudo apk add git` (Alpine) bzw. dein System-Paketmanager,
oder lade das Projekt als ZIP von GitHub und entpacke es.

### 2b) Datenordner auf der SATA-Platte anlegen

```bash
sudo mkdir -p /DATA/ring/media /DATA/ring/db /DATA/ring/secrets
```

**Was das tut:** legt die drei Ordner an, in denen später Aufnahmen, die
Datenbank und der Token liegen — alles auf der lokalen Platte.
**Erwartung:** kein Output = Erfolg.
**Wenn deine Platte nicht unter `/DATA` hängt:** finde den Pfad mit `df -h`,
lege die Ordner dort an und passe in `docker-compose.yml` die linken Pfade
(`/DATA/ring/...`) entsprechend an.

### 2c) `.env`-Datei aus der Vorlage erstellen

```bash
cp .env.example .env
```

**Was das tut:** erstellt deine persönliche Konfigurationsdatei.
**Erwartung:** kein Output = Erfolg.

### 2d) Token in die `.env` eintragen

Öffne die Datei mit einem einfachen Editor:

```bash
nano .env
```

**Was du tust:** Suche die Zeile `RING_REFRESH_TOKEN=` und füge **direkt
dahinter** (ohne Leerzeichen) deinen kopierten Token aus Schritt 1 ein:

```
RING_REFRESH_TOKEN=eyJhbGciOi...dein...Token...XYZ
```

Optional kannst du `TZ=Europe/Berlin` an deine Zeitzone anpassen. Alles andere
kannst du so lassen (`CLIP_SECONDS=30` ist gewollt).

**Speichern in nano:** `Strg`+`O`, dann `Enter`, dann `Strg`+`X` zum Beenden.
**Wenn `nano` fehlt:** `sudo apk add nano` oder nutze `vi .env`.

### 2e) Worker bauen und starten

```bash
docker compose up -d --build
```

**Was das tut:** baut das Worker-Image (dauert beim ersten Mal ein paar Minuten)
und startet es im Hintergrund.
**Erwartung:** am Ende `Started` / `Running` und keine roten Fehler.
**Wenn `docker compose` „not found":** versuche `docker-compose up -d --build`
(mit Bindestrich) — ältere Versionen heißen so.

---

## Schritt 3 — Verify (M1): Kommen echte Events an?

Das ist der entscheidende Test. **Drei Teile.**

### 3a) Logs live ansehen

```bash
docker compose logs -f ring-worker
```

**Was das tut:** zeigt die laufenden Meldungen des Workers (`-f` = mitlaufend).
**Was du beim Start erwarten solltest (ungefähr):**
```
Starting Ring NVR worker (M1: event reception)
SQLite ready
Loaded refresh token from persisted file        (oder: seeding from RING_REFRESH_TOKEN env)
Discovered camera   id=... name="..."
Subscribed to motion events
✅ Listening for motion events. Walk in front of the camera to test.
```
Wenn du diese Zeilen siehst, läuft der Worker und ist angemeldet. 🎉

**Wenn stattdessen `FATAL` / der Container neu startet:**
- „No refresh token available" → Token in `.env` fehlt/leer. Schritt 2d prüfen.
- „Could not authenticate … token may be dead" → Token ungültig/abgelaufen.
  Schritt 1 neu machen, neuen Token in `.env`, dann `docker compose up -d --build`.
- „No cameras found" → siehe Troubleshooting unten.

### 3b) Den eigentlichen Event-Test machen

Lass die Logs (3a) offen und **geh vor die Kamera** / bewege dich in ihrem
Sichtfeld. Innerhalb weniger Sekunden sollte erscheinen:

```
🔔 MOTION event received   deviceId=... deviceName="..."
```

**Das ist der Beweis, dass Events ankommen.** Du kannst es 2–3× wiederholen.

Gegenprobe in der Datenbank (neues Terminalfenster, im `ring`-Ordner):

```bash
docker run --rm -v /DATA/ring/db:/db alpine:latest sh -c \
  "apk add -q sqlite && sqlite3 /db/ring.db 'select id,kind,started_at,recording_status from events order by id desc limit 5;'"
```

**Erwartung:** eine oder mehrere Zeilen mit `motion` und `event_only`.

> ### ⛔ HARTES NO-GO (Gate #2)
> Kommt **trotz Bewegung kein** `MOTION event received` (auch nach den
> Troubleshooting-Schritten unten), dann liefert diese **2K-Kamera** über die
> inoffizielle API keine Motion-Events. **Dann ist das Projekt mit dieser
> Hardware gestoppt** — nicht weiterbauen, M2 nicht beginnen. Gib dem Architekten
> Bescheid.

### 3c) Neustart-Test (Token übersteht Restart)

```bash
docker compose restart ring-worker
docker compose logs -f ring-worker
```

**Erwartung:** Der Worker startet **ohne** erneute 2FA-Abfrage und zeigt wieder
`Loaded refresh token from persisted file` + `Listening for motion events`.
Das beweist: Der (ggf. von Ring rotierte) Token wurde lokal gespeichert und
übersteht Neustarts.

Logs schließen: `Strg`+`C` (stoppt nur die Anzeige, nicht den Worker).

---

## Troubleshooting

### „Es kommen keine Events an" (sehr wichtig bei diesem Modell)
Bekannte Eigenheiten der inoffiziellen API — der Reihe nach probieren:

1. **Ring-Handy-App schließen.** Andere aktive Ring-Clients können ein Event
   „wegschnappen", sodass der Worker es nicht sieht. App komplett beenden und
   Test 3b wiederholen.
2. **Empfindlichkeit/Motion-Zonen prüfen.** Diese stellst du in der **Ring-App**
   am Gerät ein (Quell-seitige Filterung). Stehen sie zu streng, feuert der
   Sensor nicht. (Reiner App-Schritt, kein Code.)
3. **Push neu „anstoßen" via Control Center + neuer Token.** Manchmal kommen
   Push-Events erst, nachdem der Client im Ring **Control Center** entfernt und
   ein **neuer Token** erzeugt wurde:
   - In der Ring-App: *Control Center → Autorisierte Client-Geräte* → den Eintrag
     `local-nvr` (bzw. den Namen aus `RING_CONTROL_CENTER_NAME`) **entfernen**.
   - Schritt 1 erneut ausführen → **neuen** Token in `.env` eintragen.
   - `docker compose up -d --build`, dann Test 3b wiederholen.
4. Erst wenn 1–3 nichts bringen, greift das **No-Go (Gate #2)** oben.

### „No cameras found"
- Stimmt das Ring-Konto (richtige E-Mail in Schritt 1)?
- Hängt die Kamera am selben Konto? In der Ring-App prüfen.
- Control-Center-Eintrag wie oben neu erzeugen, neuen Token holen.

### Container startet immer wieder neu
```bash
docker compose logs --tail=50 ring-worker
```
Lies die letzte `FATAL`-Zeile — sie sagt dir die Ursache (meist Token). Bei
Token-Problemen: Schritt 1 neu, neuen Token in `.env`, neu starten. **Nicht**
den Token-Befehl in schneller Schleife wiederholen (Sperr-Gefahr).

### Worker stoppen / entfernen
```bash
docker compose down          # stoppt den Worker (Daten in /DATA bleiben erhalten)
```

---

## Was als Nächstes kommt
Wenn **3a–3c grün** sind (Events kommen an, Restart hält den Token), ist **M1
bestanden**. Melde das zurück — dann geht es an **M2** (echte mp4-Aufnahme +
Thumbnail aus dem ersten Frame). Bis dahin speichert der Worker nur die
Event-Metadaten, noch keine Videos.
