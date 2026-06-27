# ring — Local, event-driven NVR for a Ring battery camera

Self-hosted, **local**, purely **event-driven** recording system for a Ring
battery camera (Ring Außenkamera Plus Akku / Outdoor Camera Plus Battery, 2K).
It replaces the Ring app/subscription for basic camera functions — **recordings
stay on your own SATA disk**, no paid Ring subscription.

Runs as Docker containers on a ZimaBlade / CasaOS (x86, no GPU). Built on the
unofficial [`dgreif/ring`](https://github.com/dgreif/ring) `ring-client-api`.

> A (free) Ring account + Ring's cloud remain **required** — the hardware has no
> local API. Only the application/storage layer is local.

## Status: M1
Worker container that authenticates, **persists the rotating refresh token**
across restarts, and receives **motion events** into a local SQLite index.
No video recording yet — that's M2.

➡️ **Setup:** [`docs/SETUP.md`](docs/SETUP.md) (beginner-friendly, copy-paste)
➡️ **Design & decisions:** [`docs/PLAN.md`](docs/PLAN.md)
➡️ **Architecture map:** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

## Quick start (see SETUP.md for details)
```bash
git clone https://github.com/Sevinc-Lab/ring.git && cd ring
sudo mkdir -p /DATA/ring/{media,db,secrets}
cp .env.example .env            # then paste your ring-auth-cli refresh token
docker compose up -d --build
docker compose logs -f ring-worker
```

## Milestones
- **M1** — worker, token persistence, motion-event reception ← *current*
- **M2** — event → mp4 clip + first-frame thumbnail + metadata
- **M3** — local Next.js dashboard (timeline + playback)
- **M4** *(deferred)* — detection + notifications

## Repository layout
```
docs/                 PLAN.md, SETUP.md, ARCHITECTURE.md
docker-compose.yml    ring-worker service (M1)
.env.example          configuration template
packages/worker/      TypeScript worker (Node 20 + ffmpeg)
```

## License
TBD.
