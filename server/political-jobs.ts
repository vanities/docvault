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
