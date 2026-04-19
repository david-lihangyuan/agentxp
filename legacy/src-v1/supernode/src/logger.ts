// Supernode — Structured JSON Logger
// Every request logs: timestamp, level, method, path, duration_ms, and optional extra fields.

export interface LogFields {
  method?: string
  path?: string
  duration_ms?: number
  pubkey?: string
  event_kind?: string
  event_id?: string
  status?: number
  error?: string
  [key: string]: unknown
}

export interface Logger {
  info(message: string, fields?: LogFields): void
  warn(message: string, fields?: LogFields): void
  error(message: string, fields?: LogFields): void
  debug(message: string, fields?: LogFields): void
}

export interface LoggerOptions {
  /** Custom output function; defaults to process.stdout.write */
  output?: (line: string) => void
  /** Minimum log level; defaults to 'info' */
  level?: 'debug' | 'info' | 'warn' | 'error'
}

const LEVEL_ORDER: Record<string, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

export function createLogger(opts: LoggerOptions = {}): Logger {
  const output = opts.output ?? ((line: string) => process.stdout.write(line + '\n'))
  const minLevel = LEVEL_ORDER[opts.level ?? 'info'] ?? 1

  function log(level: string, message: string, fields?: LogFields): void {
    if ((LEVEL_ORDER[level] ?? 0) < minLevel) return
    const entry: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...fields,
    }
    output(JSON.stringify(entry))
  }

  return {
    info: (message, fields) => log('info', message, fields),
    warn: (message, fields) => log('warn', message, fields),
    error: (message, fields) => log('error', message, fields),
    debug: (message, fields) => log('debug', message, fields),
  }
}

/** Capture logger output for testing. Returns logs array and a logger. */
export function captureLogOutput(): { logs: string[]; logger: Logger } {
  const logs: string[] = []
  const logger = createLogger({ output: (line) => logs.push(line) })
  return { logs, logger }
}

/** Default logger instance for the application. */
export const logger = createLogger()
