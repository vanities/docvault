import { jsonResponse, DATA_DIR } from '../data.js';
import { createPoliticalJobManifest, listPoliticalJobManifests } from '../political-jobs.js';

export async function handlePoliticalJobRoutes(
  req: Request,
  url: URL,
  pathname: string
): Promise<Response | null> {
  if (pathname === '/api/political-jobs' && req.method === 'GET') {
    const jobs = await listPoliticalJobManifests(DATA_DIR);
    return jsonResponse({ jobs });
  }

  if (pathname === '/api/political-jobs' && req.method === 'POST') {
    try {
      const raw = await req.json();
      const overwrite = url.searchParams.get('overwrite') === 'true';
      const manifest = await createPoliticalJobManifest(raw, { dataDir: DATA_DIR, overwrite });
      return jsonResponse({ ok: true, manifest }, 201);
    } catch (err) {
      return jsonResponse(
        { ok: false, error: err instanceof Error ? err.message : String(err) },
        400
      );
    }
  }

  return null;
}
