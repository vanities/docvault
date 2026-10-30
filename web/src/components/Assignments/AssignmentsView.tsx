import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Binoculars,
  ChevronLeft,
  Loader2,
  Mail,
  PauseCircle,
  Play,
  Plus,
  RotateCcw,
  Search,
  Send,
  Trash2,
  Wrench,
  XCircle,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { requestJson } from '@/api/client';
import { SafeMarkdown } from '../common/SafeMarkdown';
import { useToast } from '../../hooks/useToast';
import { API_BASE } from '../../constants';
import {
  LIMITS,
  type Assignment,
  type AssignmentStatus,
  type ToolUse,
  type TranscriptEntry,
} from '../../../server/assignments/types';
import {
  ASSIGNMENTS_CHANGED_EVENT,
  ENTRY_LABEL,
  RUN_OUTCOME_LABEL,
  cadenceLabel,
  countByStatus,
  formatRelative,
  idFromHash,
  scheduleLabel,
  toneOf,
  visibleAssignments,
  type AssignmentDetail,
  type AssignmentsList,
  type RunEnd,
  type StatusFilter,
  type Tone,
} from './assignments';

const LIST_POLL_MS = 60_000;
const RUN_POLL_MS = 3_000;
const CADENCE_CHOICES = [60, 180, 360, 720, 1440, 10080];
const PROSE =
  'prose prose-sm prose-surface max-w-none text-[14px] text-surface-800 [&_strong]:text-surface-950 [&_a]:text-accent-400 [&_ul]:my-2 [&_li]:my-0.5 [&_p]:my-2 [&_table]:text-[13px]';

const TONE_STYLE: Record<Tone, { label: string; cls: string }> = {
  running: { label: 'Running', cls: 'bg-accent-500/15 text-accent-400 ring-1 ring-accent-500/30' },
  ok: { label: 'Active', cls: 'bg-accent-500/10 text-accent-400 ring-1 ring-accent-500/20' },
  failing: { label: 'Failing', cls: 'bg-warn-500/15 text-warn-400 ring-1 ring-warn-500/30' },
  paused: { label: 'Paused', cls: 'bg-surface-200/60 text-surface-800 ring-1 ring-border' },
  closed: { label: 'Closed', cls: 'bg-surface-200/40 text-surface-600 ring-1 ring-border' },
};

function TonePill({ tone }: { tone: Tone }) {
  const { label, cls } = TONE_STYLE[tone];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}
    >
      {tone === 'running' && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
      {label}
    </span>
  );
}

function notifyChanged() {
  window.dispatchEvent(new Event(ASSIGNMENTS_CHANGED_EVENT));
}

export function AssignmentRow({
  assignment: a,
  pausedAll,
  now,
  selected,
  onSelect,
}: {
  assignment: Assignment;
  pausedAll: boolean;
  now: number;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(a.id)}
      aria-current={selected ? 'true' : undefined}
      className={`w-full text-left rounded-lg px-3 py-2.5 transition-colors ${selected ? 'bg-accent-500/10 ring-1 ring-accent-500/25' : 'hover:bg-surface-200/50'}`}
    >
      <div className="flex items-center gap-2">
        <span className="font-semibold text-[13px] text-surface-950 truncate flex-1">
          {a.title}
        </span>
        {a.unread > 0 && (
          <span
            className="min-w-5 h-5 px-1.5 rounded-full bg-accent-500 text-white text-[11px] font-bold flex items-center justify-center"
            aria-label={`${a.unread} unread`}
          >
            {a.unread}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 mt-1">
        <TonePill tone={toneOf(a, pausedAll)} />
        <span className="text-[11px] text-surface-600 truncate">
          {scheduleLabel(a, pausedAll, now)}
        </span>
      </div>
      {a.lastRun?.headline && (
        <p className="text-[12px] text-surface-700 mt-1 line-clamp-2">{a.lastRun.headline}</p>
      )}
    </button>
  );
}

function ToolChips({ tools }: { tools: ToolUse[] }) {
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {tools.map((t, i) => (
        <span
          key={`${t.name}-${i}`}
          className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-mono ${
            t.ok === false
              ? 'bg-danger-500/10 text-danger-400'
              : t.write
                ? 'bg-warn-500/10 text-warn-400'
                : 'bg-surface-200/60 text-surface-600'
          }`}
          title={t.write ? 'Changed your data' : 'Read only'}
        >
          {t.write && <Wrench className="w-3 h-3" />}
          {t.name}
          {t.ok === false && ' (failed)'}
        </span>
      ))}
    </div>
  );
}

function EntryCard({ entry, now }: { entry: TranscriptEntry; now: number }) {
  const tone =
    entry.kind === 'you'
      ? 'bg-accent-500/5 border-accent-500/20 md:ml-10'
      : entry.kind === 'system'
        ? 'bg-warn-500/5 border-warn-500/20'
        : 'bg-surface-100/60 border-border/50';
  return (
    <div className={`rounded-xl border px-4 py-3 ${tone}`}>
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-surface-600 mb-1">
        <span className="font-semibold uppercase tracking-wide">{ENTRY_LABEL[entry.kind]}</span>
        <span title={new Date(entry.at).toLocaleString()}>{formatRelative(entry.at, now)}</span>
        {entry.emailed && (
          <span className="inline-flex items-center gap-1 text-accent-400">
            <Mail className="w-3 h-3" /> Emailed you
          </span>
        )}
      </div>
      {entry.headline && entry.kind !== 'you' && (
        <p className="text-[13px] font-semibold text-surface-950 mb-1">{entry.headline}</p>
      )}
      <SafeMarkdown className={PROSE}>{entry.markdown}</SafeMarkdown>
      {entry.tools && entry.tools.length > 0 && <ToolChips tools={entry.tools} />}
      {entry.nextCheckAt && entry.kind !== 'you' && (
        <p className="text-[11px] text-surface-600 mt-2">
          Next check {formatRelative(entry.nextCheckAt, now)}
        </p>
      )}
    </div>
  );
}

function RunLog({ runs, now }: { runs: RunEnd[]; now: number }) {
  if (runs.length === 0) return <p className="text-[12px] text-surface-600">No runs yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="text-left text-surface-600 border-b border-border/50">
            <th className="py-1.5 pr-3 font-medium">When</th>
            <th className="py-1.5 pr-3 font-medium">Outcome</th>
            <th className="py-1.5 pr-3 font-medium">Took</th>
            <th className="py-1.5 pr-3 font-medium">Cost est.</th>
            <th className="py-1.5 font-medium">Notes</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.runId} className="border-b border-border/30 align-top">
              <td className="py-1.5 pr-3 whitespace-nowrap" title={new Date(r.at).toLocaleString()}>
                {formatRelative(r.at, now)}
              </td>
              <td
                className={`py-1.5 pr-3 ${r.outcome === 'ok' ? 'text-accent-400' : 'text-warn-400'}`}
              >
                {RUN_OUTCOME_LABEL[r.outcome]}
                {r.emailed && ' · emailed'}
              </td>
              <td className="py-1.5 pr-3 whitespace-nowrap">{Math.round(r.durationMs / 1000)}s</td>
              <td className="py-1.5 pr-3">{r.costUsd == null ? '' : `$${r.costUsd.toFixed(2)}`}</td>
              <td className="py-1.5 text-surface-700">
                {[r.error, ...r.warnings].filter(Boolean).join('; ')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NewAssignmentForm({
  onCreated,
  onCancel,
}: {
  onCreated: (a: Assignment) => void;
  onCancel: () => void;
}) {
  const { addToast } = useToast();
  const [title, setTitle] = useState('');
  const [brief, setBrief] = useState('');
  const [cadence, setCadence] = useState<number>(LIMITS.defaultIntervalMinutes);
  const [startNow, setStartNow] = useState(true);
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const { assignment } = await requestJson<{ assignment: Assignment }>(
        `${API_BASE}/assignments`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title, brief, cadenceMinutes: cadence, startNow }),
        }
      );
      addToast(
        startNow ? 'Assignment created; first check-in started' : 'Assignment created',
        'success'
      );
      onCreated(assignment);
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Could not create the assignment', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card variant="glass" className="p-5">
      <form onSubmit={submit} className="space-y-4">
        <h2 className="text-lg font-semibold text-surface-950">New assignment</h2>
        <label className="block">
          <span className="text-[12px] font-medium text-surface-700">Title</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
            required
            placeholder="Rejoin Coinbase High Yield?"
            className="mt-1 w-full rounded-lg border border-border bg-surface-50 px-3 py-2 text-[14px] text-surface-950"
          />
        </label>
        <label className="block">
          <span className="text-[12px] font-medium text-surface-700">Brief</span>
          <textarea
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            maxLength={8000}
            required
            rows={7}
            placeholder="What to watch, when to tell you, and when the job is done. For example: Check Acme Bank's savings rate. Email me if it drops below 4%. Close once I've moved the money."
            className="mt-1 w-full rounded-lg border border-border bg-surface-50 px-3 py-2 text-[14px] text-surface-950"
          />
        </label>
        <div className="flex flex-wrap items-end gap-4">
          <label className="block">
            <span className="text-[12px] font-medium text-surface-700">Check in</span>
            <select
              value={cadence}
              onChange={(e) => setCadence(Number(e.target.value))}
              className="mt-1 block rounded-lg border border-border bg-surface-50 px-3 py-2 text-[14px] text-surface-950"
            >
              {CADENCE_CHOICES.map((m) => (
                <option key={m} value={m}>
                  {cadenceLabel(m)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-[13px] text-surface-800 pb-2">
            <input
              type="checkbox"
              checked={startNow}
              onChange={(e) => setStartNow(e.target.checked)}
            />
            Check in now
          </label>
        </div>
        <p className="text-[12px] text-surface-600">
          It can use every DocVault tool, including ones that change your data, and emails you when
          something it watches changes. It sets its own pace between 1 hour and 7 days.
        </p>
        <div className="flex gap-2">
          <Button type="submit" disabled={saving || !title.trim() || !brief.trim()}>
            {saving && <Loader2 className="w-4 h-4 animate-spin" />} Create
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

function AssignmentDetailPane({
  detail,
  pausedAll,
  now,
  onBack,
  onChanged,
  onDeleted,
}: {
  detail: AssignmentDetail;
  pausedAll: boolean;
  now: number;
  onBack: () => void;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const { addToast } = useToast();
  const a = detail.assignment;
  const [busy, setBusy] = useState<string | null>(null);
  const [briefDraft, setBriefDraft] = useState(a.brief);
  const [message, setMessage] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const working = !!a.running || !!a.pendingRun;

  useEffect(() => setBriefDraft(a.brief), [a.id, a.brief]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [a.id, detail.entries.length]);

  const act = async (label: string, path: string, init: RequestInit, success: string) => {
    setBusy(label);
    try {
      await requestJson(`${API_BASE}/assignments/${a.id}${path}`, {
        headers: { 'content-type': 'application/json' },
        ...init,
      });
      addToast(success, 'success');
      onChanged();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'That did not work', 'error');
    } finally {
      setBusy(null);
    }
  };
  const setStatus = (status: AssignmentStatus, success: string) =>
    act(status, '', { method: 'PATCH', body: JSON.stringify({ status }) }, success);

  const remove = async () => {
    if (!window.confirm(`Delete "${a.title}" and its history?`)) return;
    setBusy('delete');
    try {
      await requestJson(`${API_BASE}/assignments/${a.id}`, { method: 'DELETE' });
      addToast('Assignment deleted', 'success');
      onDeleted();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Could not delete it', 'error');
    } finally {
      setBusy(null);
    }
  };

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = message.trim();
    if (!text) return;
    await act('message', '/messages', { method: 'POST', body: JSON.stringify({ text }) }, 'Sent');
    setMessage('');
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <button
            type="button"
            onClick={onBack}
            className="md:hidden inline-flex items-center gap-1 text-[12px] text-surface-600 mb-2"
          >
            <ChevronLeft className="w-4 h-4" /> All assignments
          </button>
          <h2 className="text-xl font-semibold text-surface-950 break-words">{a.title}</h2>
          <div className="flex flex-wrap items-center gap-2 mt-1.5 text-[12px] text-surface-600">
            <TonePill tone={toneOf(a, pausedAll)} />
            <span>{scheduleLabel(a, pausedAll, now)}</span>
            <span>· {cadenceLabel(a.cadenceMinutes)}</span>
            {a.consecutiveFailures > 0 && (
              <span className="text-warn-400">· {a.consecutiveFailures} failed in a row</span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={() => act('run', '/run', { method: 'POST' }, 'Check-in started')}
            disabled={working || busy !== null}
          >
            {busy === 'run' ? <Loader2 className="animate-spin" /> : <Play />} Run now
          </Button>
          {a.status === 'active' && (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy !== null}
              onClick={() => setStatus('paused', 'Paused')}
            >
              <PauseCircle /> Pause
            </Button>
          )}
          {a.status === 'paused' && (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy !== null}
              onClick={() => setStatus('active', 'Resumed')}
            >
              <RotateCcw /> Resume
            </Button>
          )}
          {a.status !== 'closed' ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy !== null}
              onClick={() => setStatus('closed', 'Closed')}
            >
              <XCircle /> Close
            </Button>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy !== null}
              onClick={() => setStatus('active', 'Reopened')}
            >
              <RotateCcw /> Reopen
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost-danger"
            disabled={working || busy !== null}
            onClick={remove}
            aria-label="Delete assignment"
          >
            <Trash2 />
          </Button>
        </div>
      </div>

      {a.status === 'closed' && a.outcome && (
        <Card variant="glass" className="p-4 text-[13px] text-surface-800">
          <span className="font-semibold text-surface-950">Outcome: </span>
          {a.outcome}
        </Card>
      )}

      <section>
        <h3 className="text-[12px] uppercase tracking-wide font-semibold text-surface-600 mb-1.5">
          Brief
        </h3>
        <textarea
          value={briefDraft}
          onChange={(e) => setBriefDraft(e.target.value)}
          rows={4}
          maxLength={8000}
          aria-label="Brief"
          className="w-full rounded-lg border border-border bg-surface-50 px-3 py-2 text-[13px] text-surface-900"
        />
        {briefDraft.trim() !== a.brief && (
          <div className="flex gap-2 mt-2">
            <Button
              size="sm"
              disabled={!briefDraft.trim() || busy !== null}
              onClick={() =>
                act(
                  'brief',
                  '',
                  { method: 'PATCH', body: JSON.stringify({ brief: briefDraft }) },
                  'Brief saved'
                )
              }
            >
              Save brief
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setBriefDraft(a.brief)}>
              Undo
            </Button>
          </div>
        )}
      </section>

      <details className="rounded-lg border border-border/50 px-3 py-2">
        <summary className="cursor-pointer text-[12px] font-semibold text-surface-700">
          Its notes {a.notes ? '' : '(none yet)'}
        </summary>
        {a.notes && (
          <pre className="mt-2 whitespace-pre-wrap text-[12px] text-surface-800 font-sans">
            {a.notes}
          </pre>
        )}
      </details>

      <section className="space-y-3">
        <h3 className="text-[12px] uppercase tracking-wide font-semibold text-surface-600">
          Thread
        </h3>
        {detail.entries.length === 0 && !working && (
          <p className="text-[13px] text-surface-600">
            No check-ins yet. Press Run now to start one.
          </p>
        )}
        {detail.entries.map((entry) => (
          <EntryCard key={entry.id} entry={entry} now={now} />
        ))}
        {working && (
          <div className="flex items-center gap-2 text-[13px] text-surface-600">
            <Loader2 className="w-4 h-4 animate-spin" />
            {a.running ? 'Checking in…' : 'Queued behind another check-in…'}
          </div>
        )}
        <div ref={endRef} />
        <form onSubmit={send} className="flex gap-2 items-end">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void send(e);
            }}
            rows={2}
            maxLength={8000}
            placeholder="Reply, or ask it to change how it works (for example: check hourly until Friday)"
            aria-label="Message"
            className="flex-1 rounded-lg border border-border bg-surface-50 px-3 py-2 text-[13px] text-surface-900"
          />
          <Button type="submit" disabled={!message.trim() || busy !== null} aria-label="Send">
            {busy === 'message' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </Button>
        </form>
      </section>

      <details className="rounded-lg border border-border/50 px-3 py-2">
        <summary className="cursor-pointer text-[12px] font-semibold text-surface-700">
          Run log ({detail.runs.length})
        </summary>
        <div className="mt-2">
          <RunLog runs={detail.runs} now={now} />
        </div>
      </details>
    </div>
  );
}

export function AssignmentsView() {
  const { addToast } = useToast();
  const [list, setList] = useState<AssignmentsList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>('active');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    idFromHash(window.location.hash)
  );
  const [detail, setDetail] = useState<AssignmentDetail | null>(null);
  const [creating, setCreating] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;

  const loadList = useCallback(async () => {
    try {
      setList(await requestJson<AssignmentsList>(`${API_BASE}/assignments`));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load assignments');
    } finally {
      setNow(Date.now());
    }
  }, []);

  const loadDetail = useCallback(
    async (id: string) => {
      try {
        const next = await requestJson<AssignmentDetail>(`${API_BASE}/assignments/${id}`);
        // A late response for an assignment the user has already left is dropped.
        if (selectedRef.current !== id) return;
        setDetail(next);
        setNow(Date.now());
        if (next.assignment.unread > 0) {
          await requestJson(`${API_BASE}/assignments/${id}/read`, { method: 'POST' });
          notifyChanged();
        }
      } catch (err) {
        if (selectedRef.current === id) {
          setDetail(null);
          addToast(err instanceof Error ? err.message : 'Could not open the assignment', 'error');
        }
      }
    },
    [addToast]
  );

  useEffect(() => {
    void loadList();
    const timer = window.setInterval(() => void loadList(), LIST_POLL_MS);
    return () => window.clearInterval(timer);
  }, [loadList]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    void loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  // Poll quickly while a run is going; refresh the list once it finishes.
  const working = !!detail && (!!detail.assignment.running || !!detail.assignment.pendingRun);
  const wasWorking = useRef(false);
  useEffect(() => {
    if (wasWorking.current && !working) {
      void loadList();
      notifyChanged();
    }
    wasWorking.current = working;
    if (!working || !selectedId) return;
    const timer = window.setInterval(() => void loadDetail(selectedId), RUN_POLL_MS);
    return () => window.clearInterval(timer);
  }, [working, selectedId, loadDetail, loadList]);

  const select = (id: string | null) => {
    setCreating(false);
    setSelectedId(id);
    window.history.replaceState(null, '', id ? `#assignments/${id}` : '#assignments');
  };

  const refreshSelected = () => {
    void loadList();
    if (selectedId) void loadDetail(selectedId);
    notifyChanged();
  };

  const pauseAll = async (paused: boolean) => {
    try {
      await requestJson(`${API_BASE}/assignments/pause-all`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ paused }),
      });
      addToast(paused ? 'All assignments paused' : 'Assignments resumed', 'success');
      void loadList();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'That did not work', 'error');
    }
  };

  const all = useMemo(() => list?.assignments ?? [], [list]);
  const counts = countByStatus(all);
  const shown = visibleAssignments(all, filter, query);
  const pausedAll = list?.pausedAll ?? false;

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-surface-600 font-semibold">
            Assignments
          </p>
          <h1 className="font-display text-3xl text-surface-950 italic mt-1">
            What should I keep an eye on?
          </h1>
          <p className="text-sm text-surface-700 mt-2">
            Each one checks in on its own and emails you when something it watches changes.
          </p>
        </div>
        <div className="flex gap-2">
          {all.length > 0 && (
            <Button size="sm" variant="secondary" onClick={() => void pauseAll(!pausedAll)}>
              {pausedAll ? <RotateCcw /> : <PauseCircle />} {pausedAll ? 'Resume all' : 'Pause all'}
            </Button>
          )}
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus /> New assignment
          </Button>
        </div>
      </div>

      {pausedAll && (
        <Card variant="glass" className="p-4 border-warn-500/30">
          <div className="flex items-start gap-2 text-[13px] text-warn-400">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>
              Every assignment is paused{list?.pausedAllReason ? `: ${list.pausedAllReason}` : ''}.
              Press Resume all once it is fixed.
            </span>
          </div>
        </Card>
      )}

      {error && (
        <Card variant="glass" className="p-4">
          <div className="flex items-center gap-2 text-sm text-danger-400">
            <AlertCircle className="w-4 h-4" /> {error}
          </div>
        </Card>
      )}

      {!list && !error ? (
        <div className="flex items-center justify-center gap-2 text-sm text-surface-600 py-12">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading assignments…
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-[18rem_minmax(0,1fr)]">
          <aside className={`space-y-3 ${selectedId || creating ? 'hidden md:block' : ''}`}>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-surface-500" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search assignments"
                aria-label="Search assignments"
                className="w-full rounded-lg border border-border bg-surface-50 pl-8 pr-3 py-2 text-[13px] text-surface-950"
              />
            </div>
            <div className="flex gap-1" role="tablist">
              {(['active', 'paused', 'closed'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  role="tab"
                  aria-selected={filter === f}
                  onClick={() => setFilter(f)}
                  className={`flex-1 rounded-md px-2 py-1 text-[12px] font-medium capitalize ${filter === f ? 'bg-surface-200 text-surface-950' : 'text-surface-600 hover:bg-surface-200/50'}`}
                >
                  {f} ({counts[f]})
                </button>
              ))}
            </div>
            <div className="space-y-1">
              {shown.map((a) => (
                <AssignmentRow
                  key={a.id}
                  assignment={a}
                  pausedAll={pausedAll}
                  now={now}
                  selected={a.id === selectedId}
                  onSelect={select}
                />
              ))}
              {shown.length === 0 && (
                <p className="text-[12px] text-surface-600 px-3 py-4">
                  {query ? 'Nothing matches.' : `No ${filter} assignments.`}
                </p>
              )}
            </div>
          </aside>

          <main className={selectedId || creating ? '' : 'hidden md:block'}>
            {creating ? (
              <NewAssignmentForm
                onCancel={() => setCreating(false)}
                onCreated={(a) => {
                  setFilter('active');
                  void loadList();
                  select(a.id);
                }}
              />
            ) : detail && selectedId ? (
              <AssignmentDetailPane
                key={detail.assignment.id}
                detail={detail}
                pausedAll={pausedAll}
                now={now}
                onBack={() => select(null)}
                onChanged={refreshSelected}
                onDeleted={() => {
                  select(null);
                  void loadList();
                  notifyChanged();
                }}
              />
            ) : selectedId ? (
              <div className="flex items-center gap-2 text-sm text-surface-600 py-12 justify-center">
                <Loader2 className="w-4 h-4 animate-spin" /> Opening…
              </div>
            ) : (
              <Card variant="glass" className="p-8 text-center">
                <Binoculars className="w-8 h-8 mx-auto text-surface-500" />
                <p className="mt-3 text-[14px] text-surface-800">
                  {all.length === 0
                    ? 'Give DocVault something to watch, like a rate, a deadline, or a news story, and it will check in on its own.'
                    : 'Pick an assignment to see its thread.'}
                </p>
                {all.length === 0 && (
                  <Button className="mt-4" size="sm" onClick={() => setCreating(true)}>
                    <Plus /> New assignment
                  </Button>
                )}
              </Card>
            )}
          </main>
        </div>
      )}
    </div>
  );
}
