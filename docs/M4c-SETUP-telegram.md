# M4c — Telegram-Benachrichtigung bei Person (Schritt für Schritt)

Ziel: Sobald der Detector auf einem Clip eine **Person** erkennt, bekommst du eine
**Telegram-Nachricht**. Ablauf:

```
ring-detector  --(Webhook POST bei 'person')-->  n8n  --(Telegram)-->  dein Handy
```

Du brauchst **kein** n8n-Vorwissen. Mach einfach Teil A–E der Reihe nach. Annahme:
n8n läuft schon auf deinem CasaOS (Standard-Port **5678**), und du kannst dich per
SSH auf dem ZimaBlade einloggen.

> Du brauchst gleich **zwei Werte**, die du dir notierst: einen **Bot-Token** (Teil A)
> und deine **Chat-ID** (Teil B).

---

## Teil A — Telegram-Bot erstellen (Bot-Token holen)

1. Öffne Telegram, suche nach **`@BotFather`** (offizieller Bot mit blauem Haken), öffne den Chat.
2. Schick `/newbot`.
3. BotFather fragt nach einem **Namen** (egal, z.B. `Ring NVR`) und einem **Benutzernamen**, der auf `bot` enden muss (z.B. `ring_nvr_petrik_bot`).
4. BotFather antwortet mit einer Zeile wie:
   ```
   Use this token to access the HTTP API:
   8123456789:AAH...langer-token...xyz
   ```
   **Kopiere diesen Token** — das ist dein **Bot-Token**. Notiere ihn.

---

## Teil B — Deine Chat-ID holen

Telegram braucht eine **Chat-ID**, damit die Nachricht bei *dir* landet.

1. Schreib **deinem eigenen neuen Bot** irgendeine Nachricht (z.B. „hallo") — wichtig, sonst darf der Bot dir später nicht schreiben.
2. Such in Telegram nach **`@userinfobot`**, öffne ihn, schick `/start`.
3. Er antwortet mit deinen Daten, u.a. **`Id: 123456789`**. **Das ist deine Chat-ID.** Notiere sie.

---

## Teil C — n8n-Workflow bauen

n8n öffnest du im Browser (meist `http://casaos.local:5678` oder über die CasaOS-App-Kachel).

### C1) Neuen Workflow + Webhook-Node
1. Oben rechts **„+ New Workflow"**.
2. Klick die große **„+"**-Fläche → suche **„Webhook"** → auswählen.
3. Im Webhook-Node einstellen:
   - **HTTP Method:** `POST`
   - **Path:** `ring-person`  (frei wählbar, aber merk ihn dir)
4. Oben steht eine **„Test URL"** und eine **„Production URL"**. Die **Production URL** brauchst du gleich (Teil D). Sie sieht etwa so aus:
   ```
   http://localhost:5678/webhook/ring-person
   ```

### C2) Telegram-Node anhängen
1. Klick rechts am Webhook-Node auf das kleine **„+"** → suche **„Telegram"** → wähle **Telegram** (Action), Operation **„Send a Text Message"** (oder „Message: Send Text").
2. Bei **Credential to connect with** → **„Create New Credential"** → füge deinen **Bot-Token** aus Teil A ein → speichern.
3. Im Telegram-Node:
   - **Chat ID:** deine Chat-ID aus Teil B.
   - **Text:** klick ins Feld, schalte (falls nötig) auf **Expression** und füge ein:
     ```
     🧍 Person erkannt
     Kamera: {{ $json.body.device_name }}
     Zeit: {{ $json.body.started_at }}
     Konfidenz: {{ $json.body.max_conf }}
     Ansehen: {{ $json.body.event_url }}
     ```
   > Falls die Felder beim Test leer bleiben: probiere `{{ $json.device_name }}` ohne `.body` — je nach n8n-Version liegt der Inhalt direkt unter `$json`.

### C3) Aktivieren
Schalte den Workflow oben rechts auf **Active** (Schalter) und **speichere** (Save). Erst dann funktioniert die **Production URL**.

---

## Teil D — URL in den Detector eintragen

Der Detector (Container) muss n8n erreichen. **Wichtig:** In der URL aus Teil C
ersetzt du `localhost` durch die **LAN-IP deines ZimaBlade** — `localhost` würde im
Container auf den Container selbst zeigen.

ZimaBlade-IP herausfinden (per SSH):
```bash
hostname -I | awk '{print $1}'      # z.B. 192.168.1.50
```

Jetzt die Werte eintragen:
```bash
cd ~/ring
nano docker-compose.yml
```
Suche den Block `ring-detector:` und trage bei den zwei leeren Zeilen ein
(IP durch deine ersetzen):
```yaml
      - N8N_WEBHOOK_URL=http://192.168.1.50:5678/webhook/ring-person
      - DASHBOARD_BASE_URL=http://192.168.1.50:8080
```
Speichern: `Strg`+`O`, `Enter`, `Strg`+`X`.

Detector mit neuer Konfig starten (Code kommt per `--build`, Worker bleibt unberührt):
```bash
docker compose up -d --build ring-detector
docker compose logs -f ring-detector
```

---

## Teil E — Testen

Schnelltest **ohne** vor die Kamera zu gehen — schick einen Test-Webhook von Hand.
Die Felder werden **flach** geschickt (genau wie der echte Detector); n8n legt sie
selbst unter `body` ab, deshalb greift die Vorlage `{{ $json.body.… }}`:
```bash
curl -X POST http://192.168.1.50:5678/webhook/ring-person \
  -H 'Content-Type: application/json' \
  -d '{"label":"person","device_name":"Garten","started_at":"test","max_conf":0.9,"event_url":"http://192.168.1.50:8080"}'
```
→ Kommt eine **Telegram-Nachricht** mit **gefüllten** Feldern? Dann steht die n8n-Seite.
*(Falls die Felder leer bleiben: in der Vorlage `{{ $json.body.… }}` ↔ `{{ $json.… }}` tauschen — je nach n8n-Version.)*

**Echter Test:** Geh vor die Kamera „Garten". Sobald der Worker aufgenommen und der
Detector eine Person erkannt hat (ein paar Sekunden nach dem Clip), kommt die
Telegram-Nachricht. Im Detector-Log siehst du dann:
```
event N -> person (…)
notified n8n for label=person
```

---

## Troubleshooting
- **Keine Telegram-Nachricht beim curl-Test:** Workflow in n8n **Active**? Chat-ID richtig? Hast du deinem Bot vorher selbst geschrieben (Teil B.1)? In n8n unter „Executions" siehst du, ob der Webhook ankam und wo es hakt.
- **curl geht, aber bei echten Events nichts:** Im Detector-Log steht `notify failed` oder kein `notified`? Prüfe `N8N_WEBHOOK_URL` (LAN-IP statt `localhost`!) und dass `NOTIFY_ENABLED=true`. Logs: `docker compose logs --tail=50 ring-detector`.
- **Felder in der Nachricht leer:** `{{ $json.body.… }}` ↔ `{{ $json.… }}` tauschen (n8n-Version).
- **Link in der Nachricht öffnet nicht von unterwegs:** normal — das Dashboard ist nur im Heim-WLAN erreichbar (lokal-only). Der Link funktioniert, wenn dein Handy im selben WLAN ist.

## Bonus (optional, später) — Thumbnail mitschicken
Telegram-Server sind im Internet und erreichen deine LAN-IP nicht direkt. Damit das
Vorschaubild trotzdem ankommt: in n8n **vor** dem Telegram-Node einen **HTTP Request**-Node
einbauen (GET auf `{{ $json.body.thumb_url }}`, Response Format „File"), und im
Telegram-Node Operation **„Send Photo"** mit den **Binärdaten** dieses Nodes. n8n liegt
im LAN und kann das Bild vom Dashboard holen und zu Telegram hochladen. (Kein Muss —
die Text-Variante oben reicht für den Alltag.)
