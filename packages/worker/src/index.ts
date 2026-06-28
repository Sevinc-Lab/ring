import { writeFile } from 'fs/promises'
import { loadConfig, parseDeviceFilter } from './config'
import { createLogger } from './log'
import { TokenStore } from './auth/tokenStore'
import { createRingApi } from './auth/ringClient'
import { Repository } from './db/repository'
import { subscribeCamera } from './events/subscriber'
import { LiveManager } from './live/liveManager'
import { WebRtcManager } from './live/webrtcManager'
import { SirenManager } from './live/sirenManager'
import { startLiveServer } from './live/server'
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
    'Starting Ring NVR worker (M2: event-driven recording)',
  )

  const tokenStore = new TokenStore(config.TOKEN_FILE, log)
  const repo = new Repository(config.DATA_DB_PATH, log)

  let ringApi: RingApi | undefined
  let heartbeat: NodeJS.Timeout | undefined
  let live: LiveManager | undefined
  let webrtc: WebRtcManager | undefined
  let siren: SirenManager | undefined

  const shutdown = (code: number): never => {
    if (heartbeat) clearInterval(heartbeat)
    try {
      live?.stopAll()
      void webrtc?.stopAll()
      void siren?.stopAll()
    } catch {
      /* ignore */
    }
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
    log.info(
      {
        id: cam.id,
        name: cam.name,
        deviceType: cam.deviceType,
        hasSiren: cam.hasSiren,
        hasLight: cam.hasLight,
        hasBattery: cam.hasBattery,
      },
      'Discovered camera',
    )
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

  const motionCtx = {
    repo,
    mediaRoot: config.DATA_MEDIA_DIR,
    clipSeconds: config.CLIP_SECONDS,
    log,
  }
  for (const cam of selected) {
    subscribeCamera(cam, motionCtx)
  }

  // On-demand live view control server (reached by the dashboard over the
  // compose network). Battery-safe: streams only while a viewer keeps it alive.
  if (config.LIVE_ENABLED) {
    live = new LiveManager(
      config.DATA_MEDIA_DIR,
      config.LIVE_MAX_SECONDS,
      config.LIVE_IDLE_TIMEOUT_SECONDS * 1000,
      log,
    )
    webrtc = new WebRtcManager(
      config.LIVE_MAX_SECONDS,
      config.LIVE_IDLE_TIMEOUT_SECONDS * 1000,
      log,
    )
    siren = new SirenManager(
      config.SIREN_GRACE_SECONDS * 1000,
      config.SIREN_MAX_SECONDS * 1000,
      log,
    )
    startLiveServer(
      config.LIVE_PORT,
      selected,
      { hls: live, webrtc, siren, repo, mediaRoot: config.DATA_MEDIA_DIR },
      log,
    )
  }

  log.info(
    { count: selected.length, clipSeconds: config.CLIP_SECONDS },
    '✅ Listening for motion events. On motion: record a clip + first-frame thumbnail to SATA. ' +
      'If NO "MOTION event received" lines appear, see Troubleshooting in docs/SETUP.md.',
  )

  // Watchdog: the reverse-engineered Ring push connection can go stale over time
  // (events silently stop arriving). A periodic clean restart re-establishes it.
  // We exit(0); `restart: unless-stopped` brings the container back with a fresh
  // connection. Once every N hours is far below any re-registration throttle.
  if (config.WORKER_RESTART_HOURS > 0) {
    const ms = config.WORKER_RESTART_HOURS * 60 * 60 * 1000
    const watchdog = setTimeout(() => {
      log.info(
        { hours: config.WORKER_RESTART_HOURS },
        'Watchdog: scheduled restart — exiting cleanly to refresh the Ring push connection',
      )
      shutdown(0)
    }, ms)
    watchdog.unref()
  }

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
