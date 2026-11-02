// What DocVault itself did and already told the owner: alert emails,
// assignment check-ins, chats, sent mail, and anything broken. Without this a
// reader repeats advice an alert or assignment already acted on (a weekly
// edition once recommended a step an alert had prompted days earlier).

import { promises as fs } from 'fs';
import path from 'path';
import { ALERTS_FILE } from '../../alerts.js';
import type { AlertsStore } from '../../alerts-types.js';
import { readRunLog, loadIndex as loadAssignmentsIndex } from '../../assignments/store.js';
import { loadIndex as loadChatIndex } from '../../chat-threads-store.js';
import { loadCustomJobStatus, customJobSourceWarnings } from '../../custom-job-runner.js';
import { CONNECTIVITY_FILE, type Outage } from '../../connectivity.js';
import { DATA_DIR, SCHEDULE_STATUS_FILE, loadSettings } from '../../data.js';
import { getConfiguredTimezone } from '../../tz.js';
import { readEmailLog } from '../../email-log.js';
import { listCustomJobManifests } from '../../jobs.js';
import { listPoliticalJobManifests } from '../../political-jobs.js';
import { simplefinSync } from '../../simplefin-sync.js';
import { AI_USAGE_LOG_FILE, summarize, type AiUsageEntry } from '../../ai/usage-log.js';
import { clip, money } from '../format.js';
import { ReadCollector, windowPhrase, windowTest } from '../request.js';
import type { ContextSource } from '../types.js';

const day = (iso: string | null | undefined) => (iso ?? '').slice(0, 10);

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export const alertsSource: ContextSource = {
  id: 'alerts',
  label: 'Alerts',
  group: 'activity',
  description:
    'Alert emails sent in the window (subject and source) and every check tripped right now, ' +
    'with its value, threshold and since when; with the standing picture, sources that fail ' +
    'to report.',
  files: ['.docvault-alerts.json'],
  async read(req) {
    const r = new ReadCollector();
    const inWindow = windowTest(req);
    await r.part('activity/alerts', async () => {
      const store = await readJson<AlertsStore>(path.join(DATA_DIR, ALERTS_FILE));
      if (!store) return;
      const label = (id: string) => store.sources[id]?.label ?? id;
      // One line per subject: a check that stays tripped sends reminders, and
      // listing each reminder buries the trips that matter.
      const sent = (store.log ?? []).filter((n) => n.ok && inWindow(n.at)).reverse();
      const bySubject = new Map<
        string,
        { first: string; last: string; count: number; source: string }
      >();
      for (const n of sent) {
        const key = `${n.sourceId}\u0000${n.subject}`;
        const seen = bySubject.get(key);
        if (seen) {
          seen.count++;
          seen.last = n.at;
        } else bySubject.set(key, { first: n.at, last: n.at, count: 1, source: n.sourceId });
      }
      for (const [key, g] of [...bySubject].slice(-25)) {
        const subject = key.split('\u0000')[1];
        const repeats = g.count > 1 ? `, sent ${g.count} times through ${day(g.last)}` : '';
        r.lines.push(`Alert email ${day(g.first)}: ${subject} (${label(g.source)}${repeats}).`);
      }
      for (const source of Object.values(store.sources)) {
        for (const c of source.checks.filter((x) => x.active)) {
          r.lines.push(
            `Tripped now (${c.severity}): ${source.label}, ${c.label}` +
              `${c.scope ? ` (${c.scope})` : ''}: ${c.value}, threshold ${c.threshold}` +
              `${c.since ? `, since ${day(c.since)}` : ''}.`
          );
        }
        if (req.full && source.failures > 0) {
          r.lines.push(
            `Alert source ${source.label} has failed its last ${source.failures} report(s)` +
              `${source.lastError ? `: ${clip(source.lastError, 140)}` : ''}.`
          );
        }
      }
    });
    return r.result();
  },
};

export const assignmentsSource: ContextSource = {
  id: 'assignments',
  label: 'Assignments',
  group: 'activity',
  description:
    'Assignment check-ins in the window (headline, whether it emailed), assignments closed in ' +
    'the window with their outcome, and each open assignment with its last result.',
  files: ['.docvault-assignments.json', 'assignments'],
  async read(req) {
    const r = new ReadCollector();
    const inWindow = windowTest(req);
    await r.part('activity/assignments', async () => {
      const index = await loadAssignmentsIndex();
      const all = Object.values(index.assignments);
      for (const a of all) {
        const runs = (await readRunLog(a.id))
          .filter((l) => l.event === 'end' && inWindow(l.at))
          .slice(-10);
        for (const run of runs) {
          if (run.event !== 'end') continue;
          const what = run.headline ?? (run.outcome === 'ok' ? 'checked in' : run.outcome);
          r.lines.push(
            `Assignment "${a.title}" ${day(run.at)}: ${clip(what, 200)}${run.emailed ? ' (emailed)' : ''}.`
          );
        }
        if (a.status === 'closed' && inWindow(a.closedAt)) {
          r.lines.push(
            `Assignment "${a.title}" closed ${day(a.closedAt)}${a.outcome ? `: ${clip(a.outcome, 200)}` : ''}.`
          );
        }
      }
      if (index.pausedAll) {
        r.lines.push(
          `All assignments are paused${index.pausedAllReason ? `: ${index.pausedAllReason}` : ''}.`
        );
      }
      if (!req.full && req.purpose !== 'query') return;
      for (const a of all.filter((x) => x.status !== 'closed')) {
        const last = a.lastRun
          ? `last check-in ${day(a.lastRun.at)}: ${clip(a.lastRun.headline ?? (a.lastRun.ok ? 'ok' : (a.lastRun.error ?? 'failed')), 160)}`
          : 'no check-in yet';
        r.lines.push(
          `Open assignment "${a.title}" (${a.status}, every ${Math.round(a.cadenceMinutes / 60)}h): ${last}.`
        );
      }
    });
    return r.result();
  },
};

export const chatsSource: ContextSource = {
  id: 'chats',
  label: 'Chats',
  group: 'activity',
  description:
    'Chat threads active in the window (title, message count, and for direct queries the ' +
    'latest message preview) and files attached in chat.',
  files: ['.docvault-chat-threads.json', 'chat-threads', '_chat-attachments'],
  async read(req) {
    const r = new ReadCollector();
    const inWindow = windowTest(req);
    await r.part('activity/chats', async () => {
      const index = await loadChatIndex();
      const threads = Object.values(index.threads)
        .filter((t) => inWindow(t.updatedAt))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 15);
      for (const t of threads) {
        r.lines.push(
          `Chat "${clip(t.title, 80)}" ${day(t.updatedAt)}: ${t.messageCount} messages` +
            (req.purpose === 'query' && t.preview ? `; latest: ${clip(t.preview, 160)}` : '') +
            '.'
        );
      }
    });
    await r.part('activity/chat-attachments', async () => {
      let names: string[] = [];
      try {
        names = await fs.readdir(path.join(DATA_DIR, '_chat-attachments'));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw err;
      }
      let attached = 0;
      for (const name of names) {
        const st = await fs.stat(path.join(DATA_DIR, '_chat-attachments', name));
        if (st.isFile() && inWindow(st.mtime.toISOString())) attached++;
      }
      if (attached) r.lines.push(`${attached} file(s) attached in chat ${windowPhrase(req)}.`);
    });
    return r.result();
  },
};

export const emailLogSource: ContextSource = {
  id: 'email-log',
  label: 'Sent email',
  group: 'activity',
  description:
    'Email DocVault sent in the window, counted by purpose (news, client, test), ' +
    'every failed send, and for direct queries each subject.',
  files: ['.docvault-email-log.json'],
  async read(req) {
    const r = new ReadCollector();
    const inWindow = windowTest(req);
    await r.part('activity/email-log', async () => {
      const sent = (await readEmailLog({ limit: 500 })).filter((e) => inWindow(e.at));
      if (!sent.length) return;
      const byPurpose = new Map<string, number>();
      for (const e of sent) byPurpose.set(e.purpose, (byPurpose.get(e.purpose) ?? 0) + 1);
      r.lines.push(
        `Emails sent ${windowPhrase(req)}: ${sent.length} (` +
          `${[...byPurpose].map(([p, n]) => `${p} ${n}`).join(', ')}).`
      );
      for (const e of sent.filter((x) => !x.ok)) {
        r.lines.push(
          `Email failed ${day(e.at)}: ${clip(e.subject, 100)}${e.error ? `: ${clip(e.error, 120)}` : ''}.`
        );
      }
      if (req.purpose !== 'query') return;
      for (const e of sent.filter((x) => x.ok).slice(0, 30)) {
        r.lines.push(`Email ${day(e.at)} (${e.purpose}): ${clip(e.subject, 120)}.`);
      }
    });
    return r.result();
  },
};

interface TaskStatus {
  lastRanAt?: string | null;
  lastSuccessAt?: string | null;
  lastError?: string | null;
  lastOutcome?: string | null;
  offlineSince?: string | null;
}

/** "1 h 47 min" / "35 min". */
function spanText(fromIso: string, toIso: string): string {
  const minutes = Math.max(0, Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 60_000));
  return minutes < 60
    ? `${minutes} min`
    : `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`;
}

/** Outage lines: one still going, and those that ended inside the window. Pure. */
export function describeOutages(
  outages: Outage[],
  inWindow: (iso: string) => boolean,
  timeZone: string,
  nowIso: string
): string[] {
  const at = new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  // Newer ICU puts a narrow no-break space before AM/PM; readers get plain text.
  const when = (iso: string) => at.format(new Date(iso)).replace(/ /g, ' ');
  const lines: string[] = [];
  const open = outages.find((o) => o.to === null);
  if (open) {
    lines.push(
      `The internet has been down since ${when(open.from)} (${spanText(open.from, nowIso)}); ` +
        'jobs that need it are waiting and run again when it is back.'
    );
  }
  for (const o of outages.filter((x) => x.to && inWindow(x.to)).slice(0, 5)) {
    lines.push(
      `The internet was down ${when(o.from)} to ${when(o.to!)} (${spanText(o.from, o.to!)}); ` +
        'jobs that failed for lack of it waited and ran again after, so they were not failures.'
    );
  }
  return lines;
}

export const systemHealthSource: ContextSource = {
  id: 'system-health',
  label: 'DocVault health',
  group: 'activity',
  description:
    'Anything broken: scheduled tasks and custom jobs that are failing, bank connections that ' +
    'need signing in again, Dropbox sync errors, internet outages the server saw; with the ' +
    'standing picture, AI usage and cost for the window.',
  files: [
    '.docvault-schedule-status.json',
    '.docvault-simplefin-status.json',
    '.docvault-sync-status.json',
    '.docvault-ai-usage.ndjson',
    CONNECTIVITY_FILE,
    'jobs',
    'political-jobs',
  ],
  async read(req) {
    const r = new ReadCollector();
    const inWindow = windowTest(req);
    await r.part('system/internet', async () => {
      const saved = await readJson<{ outages?: Outage[] }>(path.join(DATA_DIR, CONNECTIVITY_FILE));
      const outages = Array.isArray(saved?.outages) ? saved.outages : [];
      if (!outages.some((o) => o.to === null || (o.to && inWindow(o.to)))) return;
      const tz = getConfiguredTimezone(await loadSettings());
      r.lines.push(...describeOutages(outages, inWindow, tz, new Date().toISOString()));
    });
    await r.part('system/tasks', async () => {
      const status = await readJson<Record<string, TaskStatus>>(SCHEDULE_STATUS_FILE);
      for (const [task, s] of Object.entries(status ?? {})) {
        if (s.lastError && s.offlineSince) {
          r.lines.push(
            `Scheduled task ${task} is waiting for the internet (down since ${day(s.offlineSince)}); ` +
              'it runs again when the connection is back.'
          );
        } else if (s.lastError) {
          r.lines.push(
            `Scheduled task ${task} is failing (last ran ${day(s.lastRanAt)}, last success ` +
              `${day(s.lastSuccessAt) || 'never'}): ${clip(String(s.lastError), 160)}.`
          );
        }
      }
    });
    await r.part('system/jobs', async () => {
      const [records, statuses] = await Promise.all([
        listCustomJobManifests(DATA_DIR),
        loadCustomJobStatus(),
      ]);
      const manifests = records.flatMap((rec) => (rec.status === 'valid' ? [rec.manifest] : []));
      for (const w of customJobSourceWarnings(manifests, statuses)) {
        r.lines.push(`Job ${w.source}: ${clip(w.message, 160)}.`);
      }
      const political = await listPoliticalJobManifests(DATA_DIR);
      const broken = political.filter((p) => p.status !== 'valid').length;
      if (broken) r.lines.push(`${broken} politics ingest job manifest(s) can't be read.`);
    });
    await r.part('system/banks', async () => {
      const health = await simplefinSync.getHealth();
      for (const issue of health.issues) {
        r.lines.push(
          `Bank connection needs attention` +
            (issue.connectionName && !issue.message.includes(issue.connectionName)
              ? ` (${issue.connectionName})`
              : '') +
            ': ' +
            `${clip(issue.message, 140)}${issue.firstSeenAt ? `, since ${day(issue.firstSeenAt)}` : ''}.`
        );
      }
    });
    await r.part('system/dropbox', async () => {
      const sync = await readJson<{ status?: string; lastSync?: string; errors?: number }>(
        path.join(DATA_DIR, '.docvault-sync-status.json')
      );
      if (sync && (sync.errors ?? 0) > 0) {
        r.lines.push(
          `Dropbox sync reported ${sync.errors} error(s) (status ${sync.status ?? 'unknown'}, ` +
            `last sync ${day(sync.lastSync)}).`
        );
      }
    });
    if (req.full || req.purpose === 'query') {
      await r.part('system/ai-usage', async () => {
        let raw = '';
        try {
          raw = await fs.readFile(AI_USAGE_LOG_FILE, 'utf8');
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
          throw err;
        }
        const entries = raw
          .split('\n')
          .filter(Boolean)
          .flatMap((line) => {
            try {
              return [JSON.parse(line) as AiUsageEntry];
            } catch {
              return [];
            }
          })
          .filter((e) => inWindow(e.ts));
        if (!entries.length) return;
        const s = summarize(entries);
        const top = Object.entries(s.byPurpose)
          .sort((a, b) => b[1].costUsd - a[1].costUsd)
          .slice(0, 4)
          .map(([p, v]) => `${p} ${v.calls}`);
        r.lines.push(
          `AI calls ${windowPhrase(req)}: ${s.totalCalls} (${s.failedCalls} failed), ` +
            `${money(s.totalCostUsd, true)} metered cost; most: ${top.join(', ')}.`
        );
      });
    }
    return r.result();
  },
};
