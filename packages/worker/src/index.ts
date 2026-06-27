import { writeFile } from 'fs/promises'
import { loadConfig, parseDeviceFilter } from './config'
import { createLogger } from './log'
import { TokenStore } from './auth/tokenStore'
import { createRingApi } from './auth/ringClient'
import { Repository } from './db/repository'
import { subscribeCamera } from './events/subscriber'
import type { RingApi, RingCamera } from 'ring-client-api'

const HEARTBEAT_INTERVAL_MS = 60_000

async function main(): Promise<void> {
  const config = loadConfig()
  const log = createLogger(config.LOG_LEVEL)

  log.info(
    {
      controlCenter: config.RING_CONTROL_CENTER_NAME,
      clipSeconds: config.CLIP_SECONDS,
      mediaDir: config.DATA_MEDIA_DIR,
      db: config.DATA_DB_PATH,
    },
    'Starting Ring NVR worker (M1: event reception)',
  )

  const tokenStore = new TokenStore(config.TOKEN_FILE, log)
  const repo = new Repository(config.DATA_DB_PATH, log)

  let ringApi: RingApi | undefined
  let heartbeat: NodeJS.Timeout | undefined

  const shutdown = (code: number): never => {
    if (heartbeat) clearInterval(heartbeat)
    try {
      ringApi?.disconnect()
    } catch {
      /* ignore */
    }
    try {
      repo.close()
    } catch {
      /* ignore */
    }
    process.exit(code)
  }

  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      log.info({ sig }, 'Shutting down')
      shutdown(0)
    })
  }

  // Load token: file > env seed. Throws (fail-fast) if neither is present.
  const refreshToken = await tokenStore.load(config.RING_REFRESH_TOKEN)

  ringApi = createRingApi(refreshToken, config.RING_CONTROL_CENTER_NAME, tokenStore, log)

  // Fail-fast on auth/connectivity: ONE fatal log + exit, no retry loop
  // (lockout-safe — Ring flags aggressive re-auth). CasaOS restart policy
  // brings the container back; a truly dead token stays visible in logs.
  let cameras: RingCamera[] = []
  try {
    cameras = await ringApi.getCameras()
  } catch (err) {
    log.fatal(
      { err },
      'Could not authenticate / fetch cameras. The refresh token may be dead. ' +
        'NOT retrying (lockout-safe). Re-generate the token per docs/SETUP.md and restart.',
    )
    shutdown(1)
  }

  if (cameras.length === 0) {
    log.fatal('No cameras found on this Ring account. Check the account / Control Center.')
    shutdown(1)
  }

  for (const cam of cameras) {
    log.info({ id: cam.id, name: cam.name, deviceType: cam.deviceType }, 'Discovered camera')
  }

  const needles = parseDeviceFilter(config.DEVICE_FILTER)
  const selected = needles.length
    ? cameras.filter(
        (c) =>
          needles.includes(String(c.id)) ||
          needles.some((n) => c.name.toLowerCase().includes(n.toLowerCase())),
      )
    : cameras

  if (selected.length === 0) {
    log.fatal({ filter: config.DEVICE_FILTER }, 'DEVICE_FILTER matched no cameras')
    shutdown(1)
  }

  // Subscribe ONLY to the filtered `selected` set — never all `cameras`.
  // Every motion subscription keeps a device active/awake; subscribing to a
  // battery camera we don't care about would waste its battery for nothing.
  const skipped = cameras.filter((c) => !selected.includes(c))
  if (skipped.length) {
    log.info(
      { skipped: skipped.map((c) => ({ id: c.id, name: c.name })) },
      'Cameras excluded by DEVICE_FILTER — NOT subscribed (battery-safe)',
    )
  }

  for (const cam of selected) {
    subscribeCamera(cam, repo, log)
  }

  log.info(
    { count: selected.length },
    '✅ Listening for motion events. Walk in front of the camera to test. ' +
      'If NO "MOTION event received" lines appear, see M1-Gate #2 / Troubleshooting in docs/SETUP.md.',
  )

  // Heartbeat for the Docker HEALTHCHECK / CasaOS status.
  heartbeat = setInterval(() => {
    writeFile(config.HEARTBEAT_FILE, new Date().toISOString()).catch((err) =>
      log.warn({ err }, 'Failed to write heartbeat'),
    )
  }, HEARTBEAT_INTERVAL_MS)
  heartbeat.unref()
}

main().catch((err) => {
  // Last-resort handler (e.g. missing token before logger context).
  // eslint-disable-next-line no-console
  console.error('FATAL:', err instanceof Error ? err.message : err)
  process.exit(1)
})
