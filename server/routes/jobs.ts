import { DATA_DIR, jsonResponse, loadSettings } from '../data.js';
import {
  createCustomJobManifest,
  listBuiltInJobRecords,
  listCustomJobManifests,
  prepareCustomJobScript,
  type WeeklyReportSchedule,
} from '../jobs.js';
import {
  loadCustomJobStatus,
  runCustomJobNow,
  startCustomJobScheduler,
} from '../custom-job-runner.js';
import type { Settings } from '../data.js';
import type { ScheduleStatusMap } from '../scheduler.js';
import { listAutomationRuns } from '../automation-runs.js';
import { loadTimesheetStore } from '../timesheet-store.js';

export type JobRouteDeps = {
  dataDir?: string;
  loadScheduleStatus?: () => Promise<ScheduleStatusMap>;
  loadSettings?: () => Promise<Settings>;
  loadWeeklyReportConfig?: () => Promise<WeeklyReportSchedule | undefined>;
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
  if (pathname !== '/api/jobs' && !/^\/api\/jobs\/[^/]+\/(?:run|runs)$/.test(pathname)) return null;

  const dataDir = deps.dataDir ?? DATA_DIR;
  const readScheduleStatus = deps.loadScheduleStatus ?? defaultLoadScheduleStatus;
  const readSettings = deps.loadSettings ?? loadSettings;
  const readWeeklyReport =
    deps.loadWeeklyReportConfig ?? (async () => (await loadTimesheetStore()).weeklyReport);
  const restartScheduler = deps.restartCustomJobScheduler ?? startCustomJobScheduler;

  const historyMatch = /^\/api\/jobs\/([^/]+)\/runs$/.exec(pathname);
  if (historyMatch) {
    if (req.method !== 'GET') return jsonResponse({ error: 'Method not allowed' }, 405);
    try {
      const id = decodeURIComponent(historyMatch[1]);
      const builtIn = url.searchParams.get('kind') === 'built-in';
      const records = builtIn
        ? listBuiltInJobRecords(await readScheduleStatus(), (await readSettings()).schedules).map(
            (job) => job.id
          )
        : (await listCustomJobManifests(dataDir)).flatMap((job) =>
            job.status === 'valid' ? [job.manifest.id] : []
          );
      if (!records.includes(id)) return jsonResponse({ error: 'Job not found' }, 404);
      return jsonResponse({ runs: await listAutomationRuns(dataDir, id, builtIn) });
    } catch (err) {
      return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  }

  const runMatch = /^\/api\/jobs\/([^/]+)\/run$/.exec(pathname);
  if (runMatch) {
    if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);
    try {
      const dryRun =
        url.searchParams.get('dryRun') === 'true' || url.searchParams.get('dry-run') === 'true';
      const result = await runCustomJobNow(decodeURIComponent(runMatch[1]), { dataDir, dryRun });
      return jsonResponse({ ok: true, result });
    } catch (err) {
      return jsonResponse(
        { ok: false, error: err instanceof Error ? err.message : String(err) },
        400
      );
    }
  }

  if (req.method === 'GET') {
    const [customJobs, customJobStatuses, scheduleStatus, settings, weeklyReport] =
      await Promise.all([
        listCustomJobManifests(dataDir),
        loadCustomJobStatus(dataDir),
        readScheduleStatus(),
        readSettings(),
        readWeeklyReport(),
      ]);
    return jsonResponse({
      builtInJobs: listBuiltInJobRecords(scheduleStatus, settings.schedules, weeklyReport),
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
