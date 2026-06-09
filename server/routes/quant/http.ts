import { gzipSync } from 'fflate';

/** gzip + Cache-Control wrapper for quant GET responses. Browsers will serve
 *  subsequent tab-switches from their own cache (no network, no re-parse) for
 *  `maxAge` seconds, and serve stale data while revalidating in the background
 *  for up to `swr` seconds. The manual Refresh button appends a ?_=bump query
 *  param which creates a unique URL, so it always bypasses the browser cache.
 *
 *  We only gzip when the client sent `Accept-Encoding: gzip` (all modern
 *  browsers do, but scripts without the header get uncompressed JSON). */
export function cachedJsonResponse(
  req: Request,
  data: object,
  opts: { maxAge: number; swr: number }
): Response {
  const body = JSON.stringify(data);
  const acceptsGzip = (req.headers.get('accept-encoding') || '').includes('gzip');

  const commonHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    Vary: 'Accept-Encoding',
    'Cache-Control': `public, max-age=${opts.maxAge}, stale-while-revalidate=${opts.swr}`,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (acceptsGzip) {
    const gzipped = gzipSync(new TextEncoder().encode(body));
    return new Response(gzipped, {
      headers: { ...commonHeaders, 'Content-Encoding': 'gzip' },
    });
  }

  return new Response(body, { headers: commonHeaders });
}
