import pino from 'pino'

export type Logger = pino.Logger

export function createLogger(level: string): Logger {
  return pino({
    level,
    base: undefined, // no pid/hostname noise — keep logs readable for first-time users
    timestamp: pino.stdTimeFunctions.isoTime,
  })
}
