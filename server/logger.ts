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

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const IS_DEBUG = process.env.LOG_LEVEL === 'debug' || !!process.env.DEBUG;
const USE_COLOR = process.stdout?.isTTY !== false;

// =============================================================================
// In-memory ring buffer — fast, live view of the current process's recent
// logs. Served to the UI via /api/logs (no date param) for the "live session"
// tab. Loses everything on restart — use the disk log (below) for history.
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

// =============================================================================
// Daily-rotated disk log — persistent history that survives container
// restarts. One NDJSON file per day at data/logs/YYYY-MM-DD.ndjson. Old
// files past LOG_RETENTION_DAYS are pruned on each day-rollover (cheap
// because rollover is once per day, not once per log line).
//
// We duplicate DATA_DIR resolution here instead of importing from
// server/data.ts — that module imports the logger, so depending on it
// would create a cycle.
// =============================================================================

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGGER_DATA_DIR =
  process.env.DOCVAULT_DATA_DIR ||
  process.env.TAXVAULT_DATA_DIR ||
  path.join(__dirname, '..', 'data');
const LOGS_DIR = path.join(LOGGER_DATA_DIR, 'logs');
const LOG_RETENTION_DAYS = 90;

let cachedTodayDate: string | null = null;
// Serial write chain — prevents line interleaving from concurrent appendFile
// calls. Each write awaits the previous, so NDJSON stays line-correct even
// under burst load. No locking needed beyond this.
let writeChain: Promise<void> = Promise.resolve();

function getTodayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function getLogFilePath(date: string): string {
  return path.join(LOGS_DIR, `${date}.ndjson`);
}

function queueDiskWrite(entry: LogEntry): void {
  const today = getTodayDate();
  const dayRolled = cachedTodayDate !== null && cachedTodayDate !== today;
  cachedTodayDate = today;

  const filePath = getLogFilePath(today);
  const line = JSON.stringify(entry) + '\n';

  writeChain = writeChain
    .then(async () => {
      await fs.mkdir(LOGS_DIR, { recursive: true });
      await fs.appendFile(filePath, line);
      if (dayRolled) {
        await pruneOldLogs();
      }
    })
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      // Use console directly — calling the logger would recurse
      console.error(`Log disk write failed: ${msg}`);
    });
}

async function pruneOldLogs(): Promise<void> {
  try {
    const entries = await fs.readdir(LOGS_DIR);
    const cutoff = Date.now() - LOG_RETENTION_DAYS * 86_400_000;
    for (const name of entries) {
      const m = name.match(/^(\d{4}-\d{2}-\d{2})\.ndjson$/);
      if (!m) continue;
      const date = new Date(`${m[1]}T00:00:00Z`);
      if (date.getTime() < cutoff) {
        await fs.unlink(path.join(LOGS_DIR, name));
      }
    }
  } catch {
    // Dir missing or unreadable — nothing to prune
  }
}

/** List available log dates (YYYY-MM-DD), newest first. */
export async function listLogDates(): Promise<string[]> {
  try {
    const entries = await fs.readdir(LOGS_DIR);
    const dates = entries
      .map((n) => {
        const m = n.match(/^(\d{4}-\d{2}-\d{2})\.ndjson$/);
        return m ? m[1] : null;
      })
      .filter((d): d is string => d !== null);
    dates.sort().reverse();
    return dates;
  } catch {
    return [];
  }
}

/** Read a specific day's persisted log entries, with optional level+limit filter. */
export async function readLogsForDate(
  date: string,
  opts?: { level?: LogEntry['level']; limit?: number }
): Promise<LogEntry[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
  try {
    const content = await fs.readFile(getLogFilePath(date), 'utf-8');
    const lines = content.split('\n').filter(Boolean);
    let entries: LogEntry[] = [];
    for (const line of lines) {
      try {
        entries.push(JSON.parse(line) as LogEntry);
      } catch {
        // Skip corrupt line
      }
    }
    if (opts?.level) {
      entries = entries.filter((e) => e.level === opts.level);
    }
    if (opts?.limit && entries.length > opts.limit) {
      // Take the tail (most recent) — disk is chronological append order
      entries = entries.slice(entries.length - opts.limit);
    }
    return entries;
  } catch {
    return [];
  }
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
    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      namespace,
      message: msg + extra,
    };
    pushLog(entry);
    // Persist to disk too. Debug-level entries only persist when debug
    // mode is on, matching the console-output gate below.
    if (level !== 'debug' || IS_DEBUG) {
      queueDiskWrite(entry);
    }
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
