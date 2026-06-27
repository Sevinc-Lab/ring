import { RingApi } from 'ring-client-api'
import type { Logger } from '../log'
import type { TokenStore } from './tokenStore'

/**
 * Creates the RingApi and wires token rotation.
 *
 * `onRefreshTokenUpdated` fires whenever Ring rotates the refresh token (which
 * happens often). We persist the new token immediately and atomically so a
 * restart picks it up — never re-authenticating in a loop (lockout-safe).
 */
export function createRingApi(
  refreshToken: string,
  controlCenterDisplayName: string,
  store: TokenStore,
  log: Logger,
): RingApi {
  const api = new RingApi({
    refreshToken,
    controlCenterDisplayName,
  })

  api.onRefreshTokenUpdated.subscribe(async ({ newRefreshToken }) => {
    if (!newRefreshToken) return
    try {
      await store.save(newRefreshToken)
      log.info('Refresh token rotated and persisted')
    } catch (err) {
      // Do NOT crash on a persist failure — the in-memory token still works for
      // this process. But make it loud: a missed persist breaks the next restart.
      log.error({ err }, 'FAILED to persist rotated refresh token — next restart may need re-auth')
    }
  })

  return api
}
