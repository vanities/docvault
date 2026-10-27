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

/** The source's CDN refuses this client outright, so no retry will get through.
 *  The refresh records the source as blocked rather than failed (a failure that
 *  nobody can fix would trip the health alert every day) and keeps probing on
 *  its normal schedule, so it recovers by itself when the block lifts. */
export class UpstreamBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UpstreamBlockedError';
  }
}

/** A 403 served by the Akamai edge ("Access Denied"), not by the origin app.
 *  A 403 from the app itself (say, a CSRF mismatch) is our bug, not a block. */
export function isEdgeDenial(res: Response): boolean {
  return res.status === 403 && /AkamaiGHost/i.test(res.headers.get('server') ?? '');
}
