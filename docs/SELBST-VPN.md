# Firmenfreier Fernzugriff (Tailscale-Alternative) — optionale 2. Schiene

Eine **komplett kostenlose, selbst gehostete** Alternative zu Tailscale:
**WireGuard** (VPN) + **DuckDNS** (kostenlose dynamische Domain) + **Caddy**
(gratis HTTPS-Zertifikat über Let's Encrypt). Damit brauchst du **keine Firma**
für den Fernzugriff mehr — nur deinen eigenen Router.

> **Diese Schiene ändert dein laufendes System NICHT.** Sie liegt in einem
> eigenen Ordner (`remote-access/`) mit eigener Compose-Datei und wird **separat**
> gestartet/gestoppt. Dein Tailscale-Zugang bleibt unverändert — du kannst
> jederzeit **umschalten** (siehe unten).

## Voraussetzungen (ehrlich)
- Dein Internetanschluss braucht eine **öffentliche IPv4** und du musst im Router
  **einen Port weiterleiten** können. **Test:** Hast du **CGNAT** (typisch bei
  manchen Anbietern/Mobilfunk), geht reines Heim-Hosting **nicht** ohne Relay.
  Prüfen: Router-WAN-IP mit der IP auf <https://www.wieistmeineip.de> vergleichen —
  **gleich** = gut, **unterschiedlich** = vermutlich CGNAT.
- Du bist auf dem ZimaBlade per SSH und hast Docker.

---

## Schritt 1 — DuckDNS einrichten (kostenlos)
1. Auf <https://www.duckdns.org> einloggen (Google/GitHub).
2. Eine **Domain** anlegen, z.B. `meinring` → du bekommst `meinring.duckdns.org`.
3. Oben deinen **Token** kopieren (eine lange Zeichenkette).

## Schritt 2 — Router: WireGuard-Port weiterleiten
Im Router eine **Portweiterleitung** anlegen:
- **UDP 51820** → auf die LAN-IP deines ZimaBlade.
(Nur diesen einen UDP-Port — sonst nichts nach außen öffnen.)

## Schritt 3 — Konfiguration ausfüllen
```bash
cd ~/ring/remote-access
cp .env.remote.example .env
nano .env          # DASHBOARD_DOMAIN, DUCKDNS_SUBDOMAIN, DUCKDNS_TOKEN, WG_UI_PASSWORD
nano dnsmasq.conf  # <DEINE-DOMAIN> durch deine Domain ersetzen, z.B. meinring.duckdns.org
```

## Schritt 4 — Schiene starten
```bash
docker compose -f docker-compose.remote.yml up -d --build
```
Caddy holt sich nach ~1 Min das HTTPS-Zertifikat (über DuckDNS, ohne offenen
Port 80). Prüfen: `docker compose -f docker-compose.remote.yml logs caddy | tail`.

## Schritt 5 — Handy/Laptop verbinden
1. Im Browser die **WireGuard-Web-UI** öffnen: `http://<zimablade-lan-ip>:51821`
   (Login = `WG_UI_PASSWORD`).
2. **„New Client"** → Namen geben → es erscheint ein **QR-Code**.
3. **WireGuard-App** aufs Handy (offiziell, von „WireGuard Development Team",
   im Play/App Store) → **+ → QR-Code scannen** → Tunnel **aktivieren**.

## Schritt 6 — Dashboard öffnen
Mit aktivem WireGuard-Tunnel im Handy-Browser:
```
https://meinring.duckdns.org
```
→ Dashboard mit **gültigem HTTPS** (Mikro/Gegensprechen funktioniert). Die
WireGuard-Web-UI ist über `http://10.8.0.1:51821` erreichbar.

---

## Umschalten zwischen Tailscale und Eigen-VPN

Beide Schienen sind unabhängig:

| | Tailscale (aktuell) | Eigen-VPN (diese Schiene) |
|---|---|---|
| **Starten** | läuft schon | `docker compose -f docker-compose.remote.yml up -d` |
| **Stoppen** | — | `docker compose -f docker-compose.remote.yml down` |
| **Adresse** | `https://…ts.net` | `https://meinring.duckdns.org` |
| **Handy-VPN** | Tailscale-App | WireGuard-App |

**Nur zum Anschauen** musst du nichts am Ring-System ändern — einfach die
jeweilige App + Adresse nutzen.

**Optionaler „echter" Switch** (damit auch die Klingel-/Benachrichtigungs-Links
auf die neue Domain zeigen): in der **Haupt-`.env`** `DASHBOARD_BASE_URL` setzen
und Worker neu starten:
```bash
cd ~/ring
# DASHBOARD_BASE_URL=https://meinring.duckdns.org   (statt der ts.net-Adresse)
docker compose up -d ring-worker
```
Zum Zurückschalten einfach wieder die `…ts.net`-Adresse eintragen. Das ist die
**eine** Einstellung, die den aktiven Kanal für Links/Bilder bestimmt.

---

## Wie es funktioniert (kurz)
- **WireGuard** baut den verschlüsselten Tunnel (Port 51820, im Router offen).
- **DuckDNS** sorgt dafür, dass deine wechselnde Heim-IP immer unter deiner
  Domain erreichbar ist.
- **Split-DNS** (`dnsmasq`) löst die Domain **im Tunnel** auf den WG-Server
  (`10.8.0.1`) auf → so passt das HTTPS-Zertifikat, obwohl alles privat bleibt.
- **Caddy** liefert das Dashboard per HTTPS mit echtem Let's-Encrypt-Zertifikat
  (DNS-01 über DuckDNS — kein zusätzlicher offener Port).

## Fehlerbehebung
- **Kommt nicht rein / Handshake klappt nicht** → Port-Weiterleitung UDP 51820
  prüfen; CGNAT ausschließen (siehe Voraussetzungen); DuckDNS-IP aktuell?
  (`docker compose -f docker-compose.remote.yml logs duckdns`).
- **Zertifikat-Fehler** → `DUCKDNS_TOKEN`/`DASHBOARD_DOMAIN` korrekt? Caddy-Logs
  ansehen; nach Änderungen `… up -d` erneut.
- **Domain lädt nicht im Tunnel** → `dnsmasq.conf`: steht deine **echte** Domain
  in der `address=/…/10.8.0.1`-Zeile? Tunnel aus/an schalten.
- **HTTPS ok, aber kein Bild/Live** → Dashboard läuft? `http://<lan-ip>:8080`
  im LAN testen; `DASHBOARD_UPSTREAM` zeigt auf `host.docker.internal:8080`.

> **Grenze:** Bei CGNAT (keine eigene öffentliche IP) funktioniert reines
> Heim-Hosting nicht. Dann bräuchtest du doch einen erreichbaren Punkt von außen
> (z.B. IPv6, falls dein Anschluss das sauber kann) — oder du bleibst bei
> Tailscale, das genau dieses Problem für dich löst.
