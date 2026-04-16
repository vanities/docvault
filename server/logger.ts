// =============================================================================
// Structured logger — lightweight, namespace-scoped, color-coded
// =============================================================================
// Usage:
//   const log = createLogger('CoinGecko');
//   const elapsed = log.timer();
//   log.info(`Fetched ${n} prices in ${elapsed()}ms`);
//   log.warn('Stale cache — using fallback');
//   log.error('HTTP 429:', err.message);
//   log.debug('Raw payload:', JSON.stringify(payload)); // only when LOG_LEVEL=debug

const IS_DEBUG = process.env.LOG_LEVEL === 'debug' || !!process.env.DEBUG;
const USE_COLOR = process.stdout?.isTTY !== false;

// =============================================================================
// In-memory ring buffer — exposes recent log lines to the UI via /api/logs
// =============================================================================

export interface LogEntry {
  ts: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  namespace: string;
  message: string;
}

const LOG_BUFFER_SIZE = 1000;
const logBuffer: LogEntry[] = [];

function pushLog(entry: LogEntry): void {
  logBuffer.push(entry);
  if (logBuffer.length > LOG_BUFFER_SIZE) {
    logBuffer.splice(0, logBuffer.length - LOG_BUFFER_SIZE);
  }
}

export function getRecentLogs(opts?: { level?: LogEntry['level']; limit?: number }): LogEntry[] {
  let result = opts?.level ? logBuffer.filter((e) => e.level === opts.level) : logBuffer.slice();
  if (opts?.limit && result.length > opts.limit) {
    result = result.slice(result.length - opts.limit);
  }
  return result;
}

function formatArg(arg: unknown): string {
  if (arg == null) return String(arg);
  if (typeof arg === 'string') return arg;
  if (arg instanceof Error) return arg.stack || arg.message;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

const C = USE_COLOR
  ? {
      reset: '\x1b[0m',
      dim: '\x1b[2m',
      red: '\x1b[31m',
      yellow: '\x1b[33m',
      cyan: '\x1b[36m',
      gray: '\x1b[90m',
    }
  : { reset: '', dim: '', red: '', yellow: '', cyan: '', gray: '' };

function ts(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 23);
}

export function createLogger(namespace: string) {
  const tag = `[${namespace}]`;

  const record = (level: LogEntry['level'], msg: string, args: unknown[]) => {
    const extra = args.length > 0 ? ' ' + args.map(formatArg).join(' ') : '';
    pushLog({ ts: new Date().toISOString(), level, namespace, message: msg + extra });
  };

  return {
    info(msg: string, ...args: unknown[]): void {
      record('info', msg, args);
      console.log(`${C.dim}${ts()}${C.reset} ${C.cyan}INFO${C.reset}  ${tag} ${msg}`, ...args);
    },

    warn(msg: string, ...args: unknown[]): void {
      record('warn', msg, args);
      console.warn(`${C.dim}${ts()}${C.reset} ${C.yellow}WARN${C.reset}  ${tag} ${msg}`, ...args);
    },

    error(msg: string, ...args: unknown[]): void {
      record('error', msg, args);
      console.error(`${C.dim}${ts()}${C.reset} ${C.red}ERR ${C.reset}  ${tag} ${msg}`, ...args);
    },

    debug(msg: string, ...args: unknown[]): void {
      if (IS_DEBUG) {
        record('debug', msg, args);
        console.log(`${C.dim}${ts()}${C.reset} ${C.gray}DBG ${C.reset}  ${tag} ${msg}`, ...args);
      }
    },

    /** Returns a function that gives elapsed milliseconds when called. */
    timer(): () => number {
      const t0 = Date.now();
      return () => Date.now() - t0;
    },
  };
}

export type Logger = ReturnType<typeof createLogger>;
