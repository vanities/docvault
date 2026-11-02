// Can this server reach the internet right now, and when couldn't it?
//
// A failure while the internet is down belongs to the outage, not to the job,
// alert or email that hit it. After a power cut the server can boot hours
// before the internet returns; every scheduled fetch then failed, the failure
// streaks grew, and the alert engine emailed "blind" alerts as soon as the line
// came back. So code that is about to record a failure, count an alert source
// as blind, or report a failed send asks `internetIsDown()` first, and treats
// a network-shaped failure during an outage as waiting, not failing.
//
// Probing is lazy: nothing is probed while things work. Each network-shaped
// failure triggers a probe (failures that land together share one). Only a
// "down" answer is reused, for a minute: the line can drop the second after a
// good probe, and whoever asks has just seen a network failure. While the
// internet is down a timer re-probes every minute; the first probe that gets
// through closes the outage, records it in .docvault-connectivity.json, and runs
// the onReconnect listeners, which re-run whatever the outage interrupted.
//
// A probe is an HTTPS GET to well-known endpoints run by different companies,
// and any HTTP response at all counts as reachable. DOCVAULT_CONNECTIVITY_PROBES
// replaces the list (comma-separated URLs) or turns the check off ('off') on a
// network that blocks them; off means "always online", the old behavior.

import path from 'path';
import { promises as fs } from 'fs';
import { DATA_DIR } from './data.js';
import { createLogger } from './logger.js';
import { createWriteLock, writeJsonAtomic } from './write-lock.js';

const log = createLogger('Connectivity');

export const CONNECTIVITY_FILE = '.docvault-connectivity.json';
export const DEFAULT_PROBE_URLS = [
  'https://www.google.com/generate_204',
  'https://cloudflare.com/cdn-cgi/trace',
  'https://www.apple.com/library/test/success.html',
];
const PROBE_TIMEOUT_MS = 5_000;
const PROBE_CACHE_MS = 60_000;
const RECOVERY_POLL_MS = 60_000;
const MAX_OUTAGES = 100;

/**
 * Text of a failure that never reached its source: a DNS lookup, a connection
 * or a timeout. A source pushing back (403, 429, 5xx) or a parse error is not
 * one; those stay real failures even during an outage. Not "fetch failed":
 * job scripts print it before any reason, an HTTP 403 included.
 */
export const NETWORK_FAILURE =
  /getaddrinfo|EAI_AGAIN|ENOTFOUND|E(?:CONNREFUSED|CONNRESET|TIMEDOUT|TIMEOUT|NETUNREACH|HOSTUNREACH)|Failed to resolve|name resolution|timed out|Unable to connect|Connection error|ConnectionRefused|FailedToOpenSocket|no such host|i\/o timeout|dial tcp|network is unreachable|connection refused|server misbehaving/i;

export function looksLikeNetworkFailure(text: string | null | undefined): boolean {
  return !!text && NETWORK_FAILURE.test(text);
}

export interface Outage {
  /** When a probe after a failure first found the internet unreachable. */
  from: string;
  /** When a probe first got through again; null while the outage lasts. */
  to: string | null;
}

export interface ConnectivityStatus {
  /** 'off' when DOCVAULT_CONNECTIVITY_PROBES disables the check. */
  mode: 'probing' | 'off';
  online: boolean;
  /** Last probe, or null if nothing has failed since boot. */
  checkedAt: string | null;
  /** When this server process started: nothing scheduled could run before it. */
  bootedAt: string;
  /** Start of the current outage; null while online. */
  offlineSince: string | null;
  /** End of the most recent outage that has ended; null if none is recorded. */
  lastOutageEnd: string | null;
  /** Newest first, at most MAX_OUTAGES. */
  outages: Outage[];
}

/** Resolves true when the URL answered with any HTTP response. */
export type Probe = (url: string, timeoutMs: number) => Promise<boolean>;

const httpProbe: Probe = async (url, timeoutMs) => {
  try {
    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    await res.body?.cancel().catch(() => {});
    return true;
  } catch {
    return false;
  }
};

export function probeUrls(
  raw: string | undefined = process.env.DOCVAULT_CONNECTIVITY_PROBES
): string[] | 'off' {
  const value = raw?.trim();
  if (!value) return DEFAULT_PROBE_URLS;
  if (/^(off|none|false|0)$/i.test(value)) return 'off';
  const urls = value
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);
  return urls.length ? urls : DEFAULT_PROBE_URLS;
}

export interface ConnectivityMonitorOptions {
  dataDir?: string;
  probe?: Probe;
  urls?: () => string[] | 'off';
  now?: () => Date;
  cacheMs?: number;
  pollMs?: number;
  timeoutMs?: number;
}

export interface ConnectivityMonitor {
  /** True only when a probe found no endpoint reachable: one made now, or a
   *  "down" answer at most a minute old. An "up" answer is never reused. */
  internetIsDown(): Promise<boolean>;
  /** Probe now, ignoring the cache. Resolves true when online. */
  checkNow(): Promise<boolean>;
  status(): Promise<ConnectivityStatus>;
  /** Runs after an outage ends. Returns an unsubscribe function. */
  onReconnect(listener: () => unknown): () => void;
  /** Loads the saved state and resumes polling if an outage was still open. */
  start(): Promise<void>;
  stop(): void;
}

export function createConnectivityMonitor(
  opts: ConnectivityMonitorOptions = {}
): ConnectivityMonitor {
  const file = path.join(opts.dataDir ?? DATA_DIR, CONNECTIVITY_FILE);
  const probe = opts.probe ?? httpProbe;
  const urls = opts.urls ?? (() => probeUrls());
  const now = opts.now ?? (() => new Date());
  const cacheMs = opts.cacheMs ?? PROBE_CACHE_MS;
  const pollMs = opts.pollMs ?? RECOVERY_POLL_MS;
  const timeoutMs = opts.timeoutMs ?? PROBE_TIMEOUT_MS;
  const bootedAt = now().toISOString();
  const withWrite = createWriteLock();
  const listeners = new Set<() => unknown>();

  let outages: Outage[] = [];
  let checkedAtMs: number | null = null;
  let loading: Promise<void> | null = null;
  let inflight: Promise<boolean> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  const openOutage = () => outages.find((o) => o.to === null) ?? null;

  function load(): Promise<void> {
    loading ??= (async () => {
      try {
        const saved = JSON.parse(await fs.readFile(file, 'utf8')) as { outages?: unknown };
        if (Array.isArray(saved.outages)) {
          outages = saved.outages
            .filter(
              (o): o is Outage =>
                !!o &&
                typeof (o as Outage).from === 'string' &&
                ((o as Outage).to === null || typeof (o as Outage).to === 'string')
            )
            .slice(0, MAX_OUTAGES);
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          log.warn(`[load] ${CONNECTIVITY_FILE} unreadable, starting empty: ${String(err)}`);
        }
      }
    })();
    return loading;
  }

  const save = () =>
    withWrite(() => writeJsonAtomic(file, { outages })).catch((err) =>
      log.error(`[save] could not write ${CONNECTIVITY_FILE}: ${String(err)}`)
    );

  function startPolling(): void {
    if (pollTimer) return;
    pollTimer = setInterval(() => {
      void checkNow().catch((err) => log.error(`[poll] failed: ${String(err)}`));
    }, pollMs);
    pollTimer.unref?.();
  }

  function stopPolling(): void {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  async function apply(reachable: boolean, detail: string): Promise<void> {
    const open = openOutage();
    const at = now().toISOString();
    if (!reachable && !open) {
      outages = [{ from: at, to: null }, ...outages].slice(0, MAX_OUTAGES);
      startPolling();
      log.warn(
        `[offline] no probe reached the internet (${detail}); polling every ${pollMs / 1000}s`
      );
      await save();
    } else if (reachable && open) {
      open.to = at;
      stopPolling();
      const minutes = Math.round((Date.parse(at) - Date.parse(open.from)) / 60_000);
      log.info(`[online] internet back after ${minutes} min (down since ${open.from})`);
      await save();
      for (const listener of listeners) {
        Promise.resolve()
          .then(listener)
          .catch((err) => log.error(`[reconnect] listener failed: ${String(err)}`));
      }
    } else if (!reachable) {
      startPolling();
    }
  }

  function checkNow(): Promise<boolean> {
    const list = urls();
    if (list === 'off') return Promise.resolve(true);
    inflight ??= (async () => {
      await load();
      const t0 = performance.now();
      const results = await Promise.all(list.map((u) => probe(u, timeoutMs)));
      const reachable = results.some(Boolean);
      checkedAtMs = now().getTime();
      const detail = `${results.filter(Boolean).length}/${list.length} reachable in ${(performance.now() - t0).toFixed(0)}ms`;
      log.debug(`[probe] ${detail}`);
      await apply(reachable, detail);
      return reachable;
    })().finally(() => {
      inflight = null;
    });
    return inflight;
  }

  async function internetIsDown(): Promise<boolean> {
    if (urls() === 'off') return false;
    await load();
    // Reuse only a recent "down". A cached "up" once called a failure real when
    // the line had dropped 55 seconds after a good probe.
    const fresh = checkedAtMs !== null && now().getTime() - checkedAtMs < cacheMs;
    if (fresh && openOutage()) return true;
    return !(await checkNow());
  }

  async function status(): Promise<ConnectivityStatus> {
    await load();
    const open = openOutage();
    return {
      mode: urls() === 'off' ? 'off' : 'probing',
      online: !open,
      checkedAt: checkedAtMs === null ? null : new Date(checkedAtMs).toISOString(),
      bootedAt,
      offlineSince: open?.from ?? null,
      lastOutageEnd: outages.find((o) => o.to !== null)?.to ?? null,
      outages: outages.map((o) => ({ ...o })),
    };
  }

  return {
    internetIsDown,
    checkNow,
    status,
    onReconnect(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async start() {
      await load();
      // An outage still open from before a restart is checked now rather than
      // waiting for the next failure, so its end time stays close to the truth.
      if (openOutage() && urls() !== 'off') {
        startPolling();
        void checkNow().catch((err) => log.error(`[start] probe failed: ${String(err)}`));
      }
    },
    stop: stopPolling,
  };
}

/** The server's one monitor. Tests build their own with createConnectivityMonitor. */
export const connectivity = createConnectivityMonitor();

export const internetIsDown = () => connectivity.internetIsDown();
export const connectivityStatus = () => connectivity.status();
export const onReconnect = (listener: () => unknown) => connectivity.onReconnect(listener);
export const startConnectivityMonitor = () => connectivity.start();
