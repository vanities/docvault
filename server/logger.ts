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

  return {
    info(msg: string, ...args: unknown[]): void {
      console.log(`${C.dim}${ts()}${C.reset} ${C.cyan}INFO${C.reset}  ${tag} ${msg}`, ...args);
    },

    warn(msg: string, ...args: unknown[]): void {
      console.warn(`${C.dim}${ts()}${C.reset} ${C.yellow}WARN${C.reset}  ${tag} ${msg}`, ...args);
    },

    error(msg: string, ...args: unknown[]): void {
      console.error(`${C.dim}${ts()}${C.reset} ${C.red}ERR ${C.reset}  ${tag} ${msg}`, ...args);
    },

    debug(msg: string, ...args: unknown[]): void {
      if (IS_DEBUG) {
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
