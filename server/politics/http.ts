// A fetch wrapper with a default per-request timeout. Politics refreshes are
// serialized (see refresh.ts), so a single stalled external request would hang
// not just one refresh but every refresh queued behind it — including the daily
// job. A timeout makes a stall fail fast (caught per-source) instead. Callers may
// still pass their own AbortSignal, which takes precedence.

const DEFAULT_TIMEOUT_MS = 30_000;

export function timeoutFetch(ms = DEFAULT_TIMEOUT_MS): typeof fetch {
  return ((input, init) =>
    fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(ms) })) as typeof fetch;
}
