import { DATA_DIR, jsonResponse, loadSettings } from '../data.js';
import {
  createCustomJobManifest,
  listBuiltInJobRecords,
  listCustomJobManifests,
  prepareCustomJobScript,
} from '../jobs.js';
import {
  loadCustomJobStatus,
  runCustomJobNow,
  startCustomJobScheduler,
} from '../custom-job-runner.js';
import type { Settings } from '../data.js';
import type { ScheduleStatusMap } from '../scheduler.js';

export type JobRouteDeps = {
  dataDir?: string;
  loadScheduleStatus?: () => Promise<ScheduleStatusMap>;
  loadSettings?: () => Promise<Settings>;
  restartCustomJobScheduler?: (dataDir: string) => Promise<void>;
};

async function defaultLoadScheduleStatus(): Promise<ScheduleStatusMap> {
  const scheduler = await import('../scheduler.js');
  return scheduler.loadScheduleStatus();
}

export async function handleJobRoutes(
  req: Request,
  url: URL,
  pathname: string,
  deps: JobRouteDeps = {}
): Promise<Response | null> {
  if (pathname !== '/api/jobs' && !/^\/api\/jobs\/[^/]+\/run$/.test(pathname)) return null;

  const dataDir = deps.dataDir ?? DATA_DIR;
  const readScheduleStatus = deps.loadScheduleStatus ?? defaultLoadScheduleStatus;
  const readSettings = deps.loadSettings ?? loadSettings;
  const restartScheduler = deps.restartCustomJobScheduler ?? startCustomJobScheduler;

  const runMatch = /^\/api\/jobs\/([^/]+)\/run$/.exec(pathname);
  if (runMatch) {
    if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);
    try {
      const result = await runCustomJobNow(decodeURIComponent(runMatch[1]), { dataDir });
      return jsonResponse({ ok: true, result });
    } catch (err) {
      return jsonResponse(
        { ok: false, error: err instanceof Error ? err.message : String(err) },
        400
      );
    }
  }

  if (req.method === 'GET') {
    const [customJobs, customJobStatuses, scheduleStatus, settings] = await Promise.all([
      listCustomJobManifests(dataDir),
      loadCustomJobStatus(dataDir),
      readScheduleStatus(),
      readSettings(),
    ]);
    return jsonResponse({
      builtInJobs: listBuiltInJobRecords(scheduleStatus, settings.schedules),
      customJobs,
      customJobStatuses,
    });
  }

  if (req.method === 'POST') {
    try {
      const raw = await req.json();
      const overwrite = url.searchParams.get('overwrite') === 'true';
      const manifest = await createCustomJobManifest(raw, { dataDir, overwrite });
      const scriptStatus = await prepareCustomJobScript(raw, manifest, { dataDir, overwrite });
      await restartScheduler(dataDir);
      return jsonResponse({ ok: true, manifest, scriptStatus }, 201);
    } catch (err) {
      return jsonResponse(
        { ok: false, error: err instanceof Error ? err.message : String(err) },
        400
      );
    }
  }

  return jsonResponse({ error: 'Method not allowed' }, 405);
}
