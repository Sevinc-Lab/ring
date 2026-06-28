import type { Repository } from './db/repository'
import type { Logger } from './log'
import { removeMediaFile } from './mediaFs'

export interface RetentionConfig {
  enabled: boolean
  days: number
  keepLabels: string[]
  sweepHours: number
}

/**
 * Periodically delete OLD, UNIMPORTANT events so the disk never fills. An event
 * is removed (clip + thumbnail + DB row) when it is older than `days` AND its
 * label is not in `keepLabels`. Real detections (person/dog/cat/…) are kept
 * forever. Everything is local — Ring's cloud is never touched.
 *
 * Runs once shortly after boot, then every `sweepHours`. Returns a stop fn.
 */
export function startRetention(
  repo: Repository,
  mediaRoot: string,
  cfg: RetentionConfig,
  log: Logger,
): () => void {
  const keep = cfg.keepLabels.map((l) => l.trim()).filter(Boolean)

  async function sweep(): Promise<void> {
    const cutoff = new Date(Date.now() - cfg.days * 24 * 60 * 60 * 1000).toISOString()
    let expired
    try {
      expired = repo.findExpiredEvents(cutoff, keep)
    } catch (err) {
      log.warn({ err }, 'Retention sweep: query failed')
      return
    }
    if (expired.length === 0) {
      log.info({ cutoff, keep }, '🧹 Retention sweep: nothing to delete')
      return
    }
    let deleted = 0
    for (const ev of expired) {
      try {
        await removeMediaFile(mediaRoot, ev.clip_path)
        await removeMediaFile(mediaRoot, ev.thumb_path)
        if (repo.deleteEvent(ev.id)) deleted++
      } catch (err) {
        log.warn({ err, id: ev.id }, 'Retention sweep: failed to delete one event')
      }
    }
    log.info(
      { deleted, days: cfg.days, keep, cutoff },
      `🧹 Retention sweep: removed ${deleted} old unimportant event(s) — kept all ${keep.join('/')}`,
    )
  }

  // First sweep ~1 min after boot (let the worker settle), then on an interval.
  const first = setTimeout(() => void sweep(), 60_000)
  first.unref()
  const timer = setInterval(() => void sweep(), cfg.sweepHours * 60 * 60 * 1000)
  timer.unref()

  log.info(
    { days: cfg.days, keepLabels: keep, sweepHours: cfg.sweepHours },
    'Retention enabled: old unimportant events will be auto-deleted (local only)',
  )

  return () => {
    clearTimeout(first)
    clearInterval(timer)
  }
}
