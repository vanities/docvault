import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  BellOff,
  Loader2,
  Mail,
  MailX,
  PauseCircle,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ShowMore } from '@/components/ui/ShowMore';
import { useTopN } from '@/hooks/useTopN';
import { requestJson } from '@/api/client';
import { useToast } from '../../hooks/useToast';
import { API_BASE } from '../../constants';
import type {
  AlertNotification,
  AlertSourceView,
  AlertsResponse,
} from '../../../server/alerts-types';
import {
  formatAge,
  formatDuration,
  formatNumber,
  overallStatus,
  seriesKeys,
  seriesValues,
  sortChecks,
  sourceHealth,
  sourceStatus,
  type SourceStatus,
} from './alerts';
import { AlertDashboardFrame } from './AlertDashboardFrame';
import { CheckChip, SectionTitle, Sparkline } from './AlertParts';

const POLL_MS = 60_000;
const MAX_GENERIC_CHARTS = 8;

function omit<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record };
  delete next[key];
  return next;
}

const STATUS_STYLE: Record<
  SourceStatus,
  { label: string; cls: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  act: {
    label: 'Act now',
    cls: 'bg-danger-500/15 text-danger-400 ring-1 ring-danger-500/30',
    Icon: ShieldAlert,
  },
  warning: {
    label: 'Warning',
    cls: 'bg-warn-500/15 text-warn-400 ring-1 ring-warn-500/30',
    Icon: AlertTriangle,
  },
  clear: {
    label: 'All clear',
    cls: 'bg-accent-500/15 text-accent-400 ring-1 ring-accent-500/30',
    Icon: ShieldCheck,
  },
  paused: {
    label: 'Paused',
    cls: 'bg-surface-200/60 text-surface-800 ring-1 ring-border',
    Icon: PauseCircle,
  },
};

const NOTIFICATION_LABEL: Record<AlertNotification['kind'], string> = {
  trip: 'Tripped',
  reminder: 'Reminder',
  blind: 'Blind',
};

const EXAMPLE_REPORT = `POST /api/alerts/report
{
  "sourceId": "example-uptime",
  "label": "Example uptime",
  "jobId": "example-uptime-job",
  "checks": [
    {
      "id": "site:status",
      "label": "Site answers",
      "scope": "example.com",
      "severity": "critical",
      "active": false,
      "value": "200 OK",
      "threshold": "not 200"
    }
  ],
  "advice": { "critical": "Restart the web server." },
  "series": { "site.latencyMs": 123 }
}`;

function StatusPill({ status, size = 'md' }: { status: SourceStatus; size?: 'sm' | 'md' }) {
  const { label, cls, Icon } = STATUS_STYLE[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-semibold ${size === 'md' ? 'px-3 py-1 text-sm' : 'px-2 py-0.5 text-[11px]'} ${cls}`}
    >
      <Icon className={size === 'md' ? 'w-4 h-4' : 'w-3.5 h-3.5'} />
      {label}
    </span>
  );
}

/** Same look as the Settings toggles; there is no shared Switch primitive yet. */
function ToggleSwitch({
  label,
  ariaLabel,
  title,
  checked,
  busy,
  onToggle,
}: {
  label: string;
  ariaLabel: string;
  title: string;
  checked: boolean;
  busy: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span aria-hidden="true" className="text-[12px] text-surface-800">
        {label}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={ariaLabel}
        title={title}
        disabled={busy}
        onClick={onToggle}
        className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/60 disabled:cursor-wait disabled:opacity-60 ${
          checked ? 'bg-accent-500' : 'bg-surface-300'
        }`}
      >
        <span
          className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ${
            checked ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );
}

/** Generic charts for a source without its own dashboard file: one per reported series key. */
function SeriesHistory({ series }: { series: AlertSourceView['series'] }) {
  const keys = useMemo(() => seriesKeys(series).slice(0, MAX_GENERIC_CHARTS), [series]);
  if (keys.length === 0) return null;
  return (
    <div>
      <SectionTitle aside={`${series.length} reports, last 14 days`}>History</SectionTitle>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {keys.map((key) => {
          const values = seriesValues(series, key);
          const last = [...values].reverse().find((v): v is number => v != null);
          return (
            <Sparkline
              key={key}
              label={key}
              values={values}
              current={last === undefined ? 'n/a' : formatNumber(last)}
              refValue={null}
              format={formatNumber}
            />
          );
        })}
      </div>
    </div>
  );
}

function HealthNotice({
  source,
  now,
  paused,
  emails,
}: {
  source: AlertSourceView;
  now: number;
  paused: boolean;
  emails: boolean;
}) {
  if (paused) {
    return (
      <p className="text-[12px] text-surface-800 flex items-center gap-1.5">
        <PauseCircle className="w-3.5 h-3.5 text-surface-600" />
        Paused: no checks or emails until you turn it back on. What you see is from the last report.
      </p>
    );
  }
  if (!emails) {
    return (
      <p className="text-[12px] text-surface-800 flex items-center gap-1.5">
        <BellOff className="w-3.5 h-3.5 text-surface-600" />
        Emails are off: checks still run and show here, but nothing is sent.
      </p>
    );
  }
  const health = sourceHealth(source, now);
  if (health.kind === 'ok') return null;
  const failing = health.kind === 'failing';
  const message =
    health.kind === 'failing'
      ? `The last ${source.failures === 1 ? 'check' : `${source.failures} checks`} failed${source.lastError ? `: ${source.lastError}` : '.'}`
      : health.kind === 'stale'
        ? `No report in ${formatDuration(health.ageMs)}. The job may be stuck or failing; see Settings → Jobs.`
        : 'No report yet.';
  return (
    <p
      className={`text-[12px] flex items-start gap-1.5 ${failing ? 'text-danger-400' : 'text-warn-400'}`}
    >
      <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
      <span>{message}</span>
    </p>
  );
}

export function SourceCard({
  source,
  now,
  enabledOverride,
  toggling,
  toggleError,
  checking,
  emailsOverride,
  emailsBusy,
  onToggle,
  onCheck,
  onToggleEmails,
}: {
  source: AlertSourceView;
  now: number;
  enabledOverride: boolean | undefined;
  toggling: boolean;
  toggleError: string | undefined;
  checking: boolean;
  emailsOverride: boolean | undefined;
  emailsBusy: boolean;
  onToggle: () => void;
  onCheck: () => void;
  onToggleEmails: () => void;
}) {
  const enabled = enabledOverride ?? source.job?.enabled ?? true;
  const emails = emailsOverride ?? source.emails !== false;
  const status = sourceStatus({
    checks: source.checks,
    job: source.job ? { ...source.job, enabled } : null,
  });
  const checks = useMemo(() => sortChecks(source.checks), [source.checks]);
  const activeChecks = source.checks.filter((c) => c.active);
  const advice = activeChecks.some((c) => c.severity === 'critical')
    ? source.advice?.critical
    : activeChecks.length > 0
      ? source.advice?.warning
      : undefined;
  const reportedAge = source.reportedAt ? Math.max(0, now - Date.parse(source.reportedAt)) : null;

  return (
    <section className="space-y-3">
      <Card variant="glass" className="p-4 space-y-3">
        <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-surface-950">{source.label}</h2>
              <StatusPill status={status} size="sm" />
            </div>
            {source.description && (
              <p className="text-[12px] text-surface-700 mt-0.5">{source.description}</p>
            )}
            <p className="text-[11px] text-surface-600 mt-1">
              {reportedAge !== null ? `Reported ${formatAge(reportedAge)}` : 'Never reported'}
              {source.job ? ` · ${source.job.schedule}` : ''}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {source.job && (
              <ToggleSwitch
                label="Checks"
                ariaLabel={`${source.label} checks`}
                title={enabled ? 'Checks run on schedule' : 'Paused: no checks or emails'}
                checked={enabled}
                busy={toggling}
                onToggle={onToggle}
              />
            )}
            <ToggleSwitch
              label="Emails"
              ariaLabel={`${source.label} emails`}
              title={emails ? 'Emails you when a check trips' : 'Emails are off'}
              checked={emails}
              busy={emailsBusy}
              onToggle={onToggleEmails}
            />
            {source.job && (
              <Button variant="outline" size="sm" onClick={onCheck} disabled={checking}>
                <RefreshCw className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`} />
                {checking ? 'Checking…' : 'Check now'}
              </Button>
            )}
          </div>
        </div>
        {toggleError && (
          <p className="text-[12px] text-danger-400 flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5" /> {toggleError}
          </p>
        )}
        <HealthNotice source={source} now={now} paused={!!source.job && !enabled} emails={emails} />

        <div className="divide-y divide-border/40">
          {checks.map((c) => (
            <div key={c.id} className="flex items-start gap-3 py-2 min-w-0">
              <div className="w-16 flex-shrink-0 pt-0.5">
                <CheckChip check={c} />
              </div>
              <div className="min-w-0 flex-1">
                {c.scope && (
                  <p className="text-[10px] uppercase tracking-[0.12em] text-surface-600">
                    {c.scope}
                  </p>
                )}
                <p className="text-[13px] text-surface-950">{c.label}</p>
              </div>
              <div className="text-right flex-shrink-0 max-w-[45%]">
                <p className="font-mono text-[13px] text-surface-950 break-words">{c.value}</p>
                <p className="text-[11px] text-surface-600">
                  trips {c.threshold}
                  {c.active && c.since
                    ? ` · for ${formatDuration(Math.max(0, now - Date.parse(c.since)))}`
                    : ''}
                </p>
              </div>
            </div>
          ))}
          {checks.length === 0 && (
            <p className="py-2 text-xs text-surface-600">This source reported no checks.</p>
          )}
        </div>

        {advice && (
          <div
            className={`rounded-lg p-3 text-sm ${status === 'act' ? 'bg-danger-500/10 text-danger-400' : 'bg-warn-500/10 text-warn-400'}`}
          >
            <p className="font-semibold">What to do</p>
            <p className="text-surface-900 mt-0.5">{advice}</p>
          </div>
        )}
      </Card>

      {source.hasDashboard ? (
        <AlertDashboardFrame source={source} />
      ) : (
        <SeriesHistory series={source.series} />
      )}
    </section>
  );
}

function AlertLog({ log, labels }: { log: AlertNotification[]; labels: Map<string, string> }) {
  const list = useTopN(log, 8);
  if (log.length === 0) {
    return (
      <Card variant="glass" className="p-4">
        <p className="text-xs text-surface-600">No alert emails yet.</p>
      </Card>
    );
  }
  return (
    <Card variant="glass" className="px-4 divide-y divide-border/40">
      {list.visible.map((n) => (
        <div
          key={`${n.at}:${n.sourceId}:${n.kind}`}
          className="flex items-start gap-3 py-2.5 min-w-0"
        >
          {n.ok ? (
            <Mail className="w-4 h-4 mt-0.5 text-surface-600 flex-shrink-0" />
          ) : (
            <MailX className="w-4 h-4 mt-0.5 text-danger-400 flex-shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-[13px] text-surface-950 break-words">{n.subject}</p>
            <p className="text-[11px] text-surface-600">
              {new Date(n.at).toLocaleString()} · {labels.get(n.sourceId) ?? n.sourceId} ·{' '}
              {NOTIFICATION_LABEL[n.kind] ?? n.kind}
              {n.ok ? ' · sent' : <span className="text-danger-400"> · failed to send</span>}
            </p>
          </div>
        </div>
      ))}
      <ShowMore expanded={list.expanded} hiddenCount={list.hiddenCount} onToggle={list.toggle} />
    </Card>
  );
}

function EmptyState() {
  return (
    <Card variant="glass" className="p-6 space-y-3 max-w-3xl">
      <div className="flex items-center gap-2 text-surface-950 font-semibold">
        <ShieldCheck className="w-4 h-4 text-surface-600" /> No alert sources yet
      </div>
      <p className="text-sm text-surface-700">
        Any custom job can become an alert source: after each run, have it POST its checks to{' '}
        <code className="font-mono text-xs">/api/alerts/report</code>. DocVault remembers each
        check, emails you when one trips (and every 6 hours while it stays tripped), and warns you
        if the job stops reporting. Include <code className="font-mono text-xs">jobId</code> to get
        an on/off switch and a Check now button here.
      </p>
      <pre className="overflow-x-auto rounded-lg bg-surface-100 p-3 text-[11px] leading-relaxed text-surface-900 font-mono">
        {EXAMPLE_REPORT}
      </pre>
      <p className="text-sm text-surface-700">
        To give an alert its own page, put a{' '}
        <code className="font-mono text-xs">dashboard.html</code> in{' '}
        <code className="font-mono text-xs">alerts/&lt;sourceId&gt;/</code> inside the data
        directory. It shows here in a sandboxed frame and receives the source's checks, history and
        detail by <code className="font-mono text-xs">postMessage</code>. See{' '}
        <code className="font-mono text-xs">web/examples/alerts/</code> for a starting point.
      </p>
    </Card>
  );
}

export function AlertsView() {
  const [data, setData] = useState<AlertsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [enabledOverride, setEnabledOverride] = useState<Record<string, boolean>>({});
  const [toggling, setToggling] = useState<Record<string, boolean>>({});
  const [toggleErrors, setToggleErrors] = useState<Record<string, string>>({});
  const [checking, setChecking] = useState<Record<string, boolean>>({});
  const [emailsOverride, setEmailsOverride] = useState<Record<string, boolean>>({});
  const [emailsBusy, setEmailsBusy] = useState<Record<string, boolean>>({});
  const { addToast } = useToast();

  const load = useCallback(async () => {
    try {
      setData(await requestJson<AlertsResponse>(`${API_BASE}/alerts`));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      setNow(Date.now());
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const toggleSource = useCallback(
    async (source: AlertSourceView) => {
      if (!source.job || toggling[source.id]) return;
      const next = !(enabledOverride[source.id] ?? source.job.enabled);
      setEnabledOverride((o) => ({ ...o, [source.id]: next }));
      setToggling((t) => ({ ...t, [source.id]: true }));
      setToggleErrors((e) => omit(e, source.id));
      try {
        // Re-read the manifest so a stale poll never undoes an edit made in Settings → Jobs.
        const fresh = await requestJson<AlertsResponse>(`${API_BASE}/alerts`);
        const job = fresh.sources.find((s) => s.id === source.id)?.job;
        if (!job)
          throw new Error('The job behind this alert no longer exists. See Settings → Jobs.');
        const res = await requestJson<{ ok?: boolean; error?: string }>(
          `${API_BASE}/jobs?overwrite=true`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: job.id,
              label: job.label,
              schedule: job.schedule,
              script: job.script,
              enabled: next,
              tags: job.tags,
            }),
          }
        );
        if (res.ok === false) throw new Error(res.error || 'Could not update the job');
        addToast(next ? `${source.label} is on` : `${source.label} is paused`, 'success');
        await load();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setToggleErrors((e) => ({
          ...e,
          [source.id]: `Could not switch it ${next ? 'on' : 'off'}: ${message}`,
        }));
        addToast(message, 'error');
      } finally {
        setEnabledOverride((o) => omit(o, source.id));
        setToggling((t) => omit(t, source.id));
      }
    },
    [addToast, enabledOverride, load, toggling]
  );

  const toggleEmails = useCallback(
    async (source: AlertSourceView) => {
      if (emailsBusy[source.id]) return;
      const next = !(emailsOverride[source.id] ?? source.emails !== false);
      setEmailsOverride((o) => ({ ...o, [source.id]: next }));
      setEmailsBusy((b) => ({ ...b, [source.id]: true }));
      try {
        const res = await requestJson<{ ok?: boolean; error?: string }>(
          `${API_BASE}/alerts/sources/${encodeURIComponent(source.id)}/settings`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ emails: next }),
          }
        );
        if (res.ok === false) throw new Error(res.error || 'Could not save the setting');
        addToast(
          next ? `${source.label} will email you` : `${source.label} emails are off`,
          'success'
        );
        await load();
      } catch (err) {
        addToast(err instanceof Error ? err.message : String(err), 'error');
      } finally {
        setEmailsOverride((o) => omit(o, source.id));
        setEmailsBusy((b) => omit(b, source.id));
      }
    },
    [addToast, emailsBusy, emailsOverride, load]
  );

  const checkSource = useCallback(
    async (source: AlertSourceView) => {
      if (!source.job) return;
      setChecking((c) => ({ ...c, [source.id]: true }));
      try {
        const res = await requestJson<{
          ok?: boolean;
          error?: string;
          result?: { outcome?: string };
        }>(`${API_BASE}/jobs/${encodeURIComponent(source.job.id)}/run`, { method: 'POST' });
        if (res.ok === false) addToast(res.error || 'The check failed', 'error');
        else
          addToast(
            `Check ${res.result?.outcome ?? 'finished'}`,
            res.result?.outcome === 'error' ? 'error' : 'success'
          );
      } catch (err) {
        addToast(err instanceof Error ? err.message : 'The check failed', 'error');
      } finally {
        setChecking((c) => omit(c, source.id));
        void load();
      }
    },
    [addToast, load]
  );

  const sources = useMemo(() => data?.sources ?? [], [data]);
  const effective = sources.map((s) =>
    s.job && enabledOverride[s.id] !== undefined
      ? { ...s, job: { ...s.job, enabled: enabledOverride[s.id] } }
      : s
  );
  const overall = overallStatus(effective);
  const labels = useMemo(() => new Map(sources.map((s) => [s.id, s.label])), [sources]);

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-surface-600 font-semibold">
            Alerts
          </p>
          <h1 className="font-display text-3xl text-surface-950 italic mt-1">
            Is anything tripped?
          </h1>
          <p className="text-sm text-surface-700 mt-2">Emails you only when a check trips.</p>
        </div>
        {sources.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={overall.status} />
            {overall.paused > 0 && (
              <span className="text-[12px] text-surface-700 px-2 py-0.5 rounded-full bg-surface-200/60">
                {overall.paused} paused
              </span>
            )}
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 text-sm text-surface-600 py-12">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading alerts…
        </div>
      ) : error ? (
        <Card variant="glass" className="p-4">
          <div className="flex items-center gap-2 text-sm text-danger-400">
            <AlertCircle className="w-4 h-4" /> {error}
          </div>
        </Card>
      ) : sources.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-8">
          {sources.map((source) => (
            <SourceCard
              key={source.id}
              source={source}
              now={now}
              enabledOverride={enabledOverride[source.id]}
              toggling={!!toggling[source.id]}
              toggleError={toggleErrors[source.id]}
              checking={!!checking[source.id]}
              emailsOverride={emailsOverride[source.id]}
              emailsBusy={!!emailsBusy[source.id]}
              onToggle={() => void toggleSource(source)}
              onCheck={() => void checkSource(source)}
              onToggleEmails={() => void toggleEmails(source)}
            />
          ))}
          <section>
            <SectionTitle
              aside={data?.log.length ? `${data.log.length} sent or attempted` : undefined}
            >
              Alert emails
            </SectionTitle>
            <AlertLog log={data?.log ?? []} labels={labels} />
          </section>
        </div>
      )}
    </div>
  );
}
