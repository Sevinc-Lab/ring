import { promises as fs } from 'fs'
import { dirname } from 'path'
import type { Logger } from '../log'

/**
 * Persists the Ring refresh token and survives container restarts.
 *
 * Load priority: persisted FILE > env SEED. The rotated token in the file
 * always wins over a stale RING_REFRESH_TOKEN seed in .env.
 *
 * Writes are atomic (write *.tmp, then rename) so a crash mid-write can never
 * leave a corrupt/empty token on disk — the #1 failure source for this kind
 * of integration.
 */
export class TokenStore {
  constructor(
    private readonly file: string,
    private readonly log: Logger,
  ) {}

  /** Returns a usable refresh token or throws (fail-fast, no re-auth loop). */
  async load(seed: string): Promise<string> {
    const fromFile = await this.readFile()
    if (fromFile) {
      this.log.info({ file: this.file }, 'Loaded refresh token from persisted file')
      return fromFile
    }

    if (seed && seed.trim()) {
      this.log.warn(
        'No persisted token yet — seeding from RING_REFRESH_TOKEN env (first start). ' +
          'It will be persisted and rotated automatically from now on.',
      )
      await this.save(seed.trim())
      return seed.trim()
    }

    throw new Error(
      'No refresh token available. Set RING_REFRESH_TOKEN in .env for the first start ' +
        '(generate it with ring-auth-cli — see docs/SETUP.md).',
    )
  }

  private async readFile(): Promise<string | null> {
    try {
      const t = (await fs.readFile(this.file, 'utf8')).trim()
      return t.length > 0 ? t : null
    } catch (err: any) {
      if (err?.code === 'ENOENT') return null
      throw err
    }
  }

  /** Atomically persist a token with restrictive permissions. */
  async save(token: string): Promise<void> {
    await fs.mkdir(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    await fs.writeFile(tmp, token, { mode: 0o600 })
    await fs.rename(tmp, this.file)
    this.log.info({ file: this.file }, 'Persisted refresh token (atomic write)')
  }
}
