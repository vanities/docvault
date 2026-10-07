import { promises as fs } from 'fs';
import path from 'path';

const JOB_ID_RE = /^[a-z0-9][a-z0-9-]{1,80}$/;
const SCRIPT_RE = /^scripts\/[a-zA-Z0-9._/-]+\.local\.(js|ts|sh)$/;

export type PoliticalJobSchedule = 'hourly' | 'daily' | `every ${number}h`;

export type PoliticalJobManifest = {
  id: string;
  label: string;
  schedule: PoliticalJobSchedule;
  script: string;
  enabled: boolean;
  tags: string[];
};

export type PoliticalJobRecord =
  | {
      status: 'valid';
      path: string;
      manifest: PoliticalJobManifest;
    }
  | {
      status: 'invalid';
      path: string;
      error: string;
    };

export type CreatePoliticalJobOptions = {
  dataDir: string;
  overwrite?: boolean;
};

export const POLITICAL_JOBS_DIR = 'political-jobs';
export const POLITICAL_JOBS_INBOX_DIR = 'inbox';
export const POLITICAL_JOBS_SCRIPTS_DIR = 'scripts';
export const POLITICAL_JOBS_RUNS_DIR = 'runs';
export const POLITICAL_JOBS_LOGS_DIR = 'logs';

function assertString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function parseSchedule(value: unknown): PoliticalJobSchedule {
  const schedule = assertString(value, 'schedule');
  if (schedule === 'hourly' || schedule === 'daily') return schedule;
  if (/^every [1-9][0-9]*h$/.test(schedule)) return schedule as PoliticalJobSchedule;
  throw new Error('schedule must be hourly, daily, or every Nh');
}

function parseTags(value: unknown): string[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error('tags must be an array');
  return value
    .filter((tag): tag is string => typeof tag === 'string')
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 20);
}

export function parsePoliticalJobManifest(raw: unknown): PoliticalJobManifest {
  if (!raw || typeof raw !== 'object') {
    throw new Error('manifest must be an object');
  }
  const obj = raw as Record<string, unknown>;
  const id = assertString(obj.id, 'id');
  if (!JOB_ID_RE.test(id)) {
    throw new Error('id must be lowercase kebab-case');
  }

  const script = assertString(obj.script, 'script');
  if (!SCRIPT_RE.test(script) || script.includes('..')) {
    throw new Error(
      'script must live under scripts/ and end with .local.js, .local.ts, or .local.sh'
    );
  }

  return {
    id,
    label: assertString(obj.label, 'label'),
    schedule: parseSchedule(obj.schedule),
    script,
    enabled: obj.enabled === undefined ? false : obj.enabled === true,
    tags: parseTags(obj.tags),
  };
}

export function politicalJobsRoot(dataDir: string): string {
  return path.join(dataDir, POLITICAL_JOBS_DIR);
}

export function politicalJobsInboxDir(dataDir: string): string {
  return path.join(politicalJobsRoot(dataDir), POLITICAL_JOBS_INBOX_DIR);
}

export function politicalJobManifestPath(dataDir: string, id: string): string {
  if (!JOB_ID_RE.test(id)) throw new Error('id must be lowercase kebab-case');
  return path.join(politicalJobsInboxDir(dataDir), `${id}.json`);
}

export async function ensurePoliticalJobLayout(dataDir: string): Promise<void> {
  const root = politicalJobsRoot(dataDir);
  await Promise.all([
    fs.mkdir(path.join(root, POLITICAL_JOBS_INBOX_DIR), { recursive: true }),
    fs.mkdir(path.join(root, POLITICAL_JOBS_SCRIPTS_DIR), { recursive: true }),
    fs.mkdir(path.join(root, POLITICAL_JOBS_RUNS_DIR), { recursive: true }),
    fs.mkdir(path.join(root, POLITICAL_JOBS_LOGS_DIR), { recursive: true }),
  ]);
}

export async function createPoliticalJobManifest(
  raw: unknown,
  options: CreatePoliticalJobOptions
): Promise<PoliticalJobManifest> {
  const manifest = parsePoliticalJobManifest(raw);
  await ensurePoliticalJobLayout(options.dataDir);
  const manifestPath = politicalJobManifestPath(options.dataDir, manifest.id);

  if (!options.overwrite) {
    try {
      await fs.access(manifestPath);
      throw new Error(`political job already exists: ${manifest.id}`);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('political job already exists')) {
        throw err;
      }
    }
  }

  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  return manifest;
}

export async function listPoliticalJobManifests(dataDir: string): Promise<PoliticalJobRecord[]> {
  await ensurePoliticalJobLayout(dataDir);
  const inbox = politicalJobsInboxDir(dataDir);
  const entries = await fs.readdir(inbox, { withFileTypes: true });
  const records = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(async (entry): Promise<PoliticalJobRecord> => {
        const manifestPath = path.join(inbox, entry.name);
        try {
          const raw = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
          return {
            status: 'valid',
            path: manifestPath,
            manifest: parsePoliticalJobManifest(raw),
          };
        } catch (err) {
          return {
            status: 'invalid',
            path: manifestPath,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      })
  );

  return records;
}
