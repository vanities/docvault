// Weekly Report tab — configure the scheduled categorized timesheet email
// (recipients, send day/hour/timezone, keyword→category rules), preview any
// week's report, download its CSV, and send off-cycle on demand.

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Send, Trash2, Download, Eye } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useConfirmDialog } from '../../hooks/useConfirmDialog';
import { Money } from '../common/Money';
import {
  tsJson,
  formatUsd,
  type TimesheetStore,
  type WeeklyReportConfig,
  type WeeklyReportPreview,
} from './types';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const SELECT_CLS = 'h-8 rounded-lg text-[12px] bg-surface-100 border border-border px-2';

interface RuleForm {
  name: string;
  keywords: string; // comma-separated in the form
}

function fmtHours(minutes: number): string {
  return (minutes / 60).toFixed(2);
}

export function WeeklyReportTab({ store }: { store: TimesheetStore }) {
  const { confirm, ConfirmDialog } = useConfirmDialog();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [lastSent, setLastSent] = useState<{ week?: string; at?: string }>({});

  // Config form
  const [enabled, setEnabled] = useState(false);
  const [to, setTo] = useState('');
  const [day, setDay] = useState(5);
  const [hour, setHour] = useState(15);
  const [timezone, setTimezone] = useState('');
  const [clientIds, setClientIds] = useState<string[]>([]);
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [rules, setRules] = useState<RuleForm[]>([]);

  // Preview
  const [previewEnd, setPreviewEnd] = useState('');
  const [preview, setPreview] = useState<WeeklyReportPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    void tsJson<{ config: WeeklyReportConfig }>('/weekly-report/config', 'GET')
      .then(({ config }) => {
        setEnabled(config.enabled);
        setTo(config.to);
        setDay(config.day);
        setHour(config.hour);
        setTimezone(config.timezone ?? '');
        setClientIds(config.clientIds ?? []);
        setProjectIds(config.projectIds ?? []);
        setRules(config.categories.map((c) => ({ name: c.name, keywords: c.keywords.join(', ') })));
        setLastSent({ week: config.lastSentWeek, at: config.lastSentAt });
      })
      .catch((err) => setStatus(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  const configBody = useCallback(
    () => ({
      enabled,
      to,
      day,
      hour,
      ...(timezone.trim() ? { timezone: timezone.trim() } : {}),
      clientIds,
      projectIds,
      categories: rules
        .map((r) => ({
          name: r.name.trim(),
          keywords: r.keywords
            .split(',')
            .map((k) => k.trim())
            .filter(Boolean),
        }))
        .filter((r) => r.name),
    }),
    [enabled, to, day, hour, timezone, clientIds, projectIds, rules]
  );

  const save = async () => {
    setSaving(true);
    setStatus('');
    try {
      const res = await tsJson<{ config: WeeklyReportConfig }>(
        '/weekly-report/config',
        'PUT',
        configBody()
      );
      setRules(
        res.config.categories.map((c) => ({ name: c.name, keywords: c.keywords.join(', ') }))
      );
      setStatus('Saved.');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const runPreview = async () => {
    setPreviewing(true);
    setStatus('');
    try {
      const q = previewEnd ? `?end=${previewEnd}` : '';
      setPreview(await tsJson<WeeklyReportPreview>(`/weekly-report/preview${q}`, 'GET'));
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setPreviewing(false);
    }
  };

  const downloadCsv = () => {
    if (!preview) return;
    const blob = new Blob([preview.csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `timesheet-${preview.window.start}-to-${preview.window.end}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const sendNow = async () => {
    const target = to.trim();
    if (!target) {
      setStatus('Add a recipient first.');
      return;
    }
    const end = previewEnd || 'today';
    const ok = await confirm({
      title: 'Send weekly report?',
      description: `Emails the report for the week ending ${end} to ${target}.`,
      confirmLabel: 'Send',
    });
    if (!ok) return;
    setSending(true);
    setStatus('');
    try {
      const res = await tsJson<{ sentTo: string; weekEnd: string; rowCount: number }>(
        '/weekly-report/send',
        'POST',
        previewEnd ? { end: previewEnd } : {}
      );
      setLastSent({ week: res.weekEnd, at: new Date().toISOString() });
      setStatus(`Sent week ending ${res.weekEnd} (${res.rowCount} entries) to ${res.sentTo}.`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-surface-500" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ConfirmDialog />

      <Card className="p-4 space-y-3">
        <h3 className="text-[13px] font-semibold">Schedule &amp; Delivery</h3>
        <p className="text-[12px] text-surface-500">
          Emails a categorized summary of the trailing 7 days of time entries (HTML + CSV
          attachment) so hours can be folded into downstream client bills.
        </p>
        <label className="flex items-center gap-2 text-[13px] text-surface-700 cursor-pointer">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Send automatically every week
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="Recipients (comma-separated)"
            className="h-8 text-[12px] w-72"
          />
          <select
            value={day}
            onChange={(e) => setDay(Number(e.target.value))}
            className={SELECT_CLS}
            aria-label="Send day"
          >
            {DAYS.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </select>
          <select
            value={hour}
            onChange={(e) => setHour(Number(e.target.value))}
            className={SELECT_CLS}
            aria-label="Send hour"
          >
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, '0')}:00
              </option>
            ))}
          </select>
          <Input
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            placeholder="Timezone (default: server)"
            className="h-8 text-[12px] w-52"
            aria-label="Timezone override"
          />
        </div>
        {lastSent.week && (
          <p className="text-[12px] text-surface-500">
            Last sent: week ending {lastSent.week}
            {lastSent.at ? ` (${new Date(lastSent.at).toLocaleString()})` : ''}
          </p>
        )}
      </Card>

      <Card className="p-4 space-y-3">
        <h3 className="text-[13px] font-semibold">Scope</h3>
        <p className="text-[12px] text-surface-500">
          Which work this recipient may see. Leave everything unchecked to include all clients —
          otherwise only the selected clients&apos; (and projects&apos;) entries are reported.
        </p>
        <div className="flex flex-wrap gap-x-5 gap-y-1.5">
          {store.clients
            .filter((c) => !c.archived)
            .map((c) => (
              <label
                key={c.id}
                className="flex items-center gap-2 text-[13px] text-surface-700 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={clientIds.includes(c.id)}
                  onChange={(e) =>
                    setClientIds(
                      e.target.checked
                        ? [...clientIds, c.id]
                        : clientIds.filter((id) => id !== c.id)
                    )
                  }
                />
                {c.name}
              </label>
            ))}
        </div>
        {clientIds.length > 0 && (
          <div className="flex flex-wrap gap-x-5 gap-y-1.5 pt-1 border-t border-border">
            {store.projects
              .filter((p) => !p.archived && clientIds.includes(p.clientId))
              .map((p) => (
                <label
                  key={p.id}
                  className="flex items-center gap-2 text-[12px] text-surface-600 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={projectIds.includes(p.id)}
                    onChange={(e) =>
                      setProjectIds(
                        e.target.checked
                          ? [...projectIds, p.id]
                          : projectIds.filter((id) => id !== p.id)
                      )
                    }
                  />
                  {p.name}
                </label>
              ))}
            <span className="text-[12px] text-surface-500">
              (no project checked = all of the selected clients&apos; projects)
            </span>
          </div>
        )}
      </Card>

      <Card className="p-4 space-y-3">
        <h3 className="text-[13px] font-semibold">Categories</h3>
        <p className="text-[12px] text-surface-500">
          Rules run top-down; the first keyword match on an entry&apos;s description or project
          wins. Unmatched entries fall back to their project name.
        </p>
        {rules.map((rule, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <Input
              value={rule.name}
              onChange={(e) =>
                setRules(rules.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))
              }
              placeholder="Category name"
              className="h-8 text-[12px] w-52"
            />
            <Input
              value={rule.keywords}
              onChange={(e) =>
                setRules(rules.map((r, j) => (j === i ? { ...r, keywords: e.target.value } : r)))
              }
              placeholder="Keywords (comma-separated)"
              className="h-8 text-[12px] flex-1 min-w-52"
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setRules(rules.filter((_, j) => j !== i))}
              aria-label="Remove rule"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRules([...rules, { name: '', keywords: '' }])}
          >
            <Plus className="w-4 h-4 mr-1" /> Add rule
          </Button>
          <Button size="sm" onClick={() => void save()} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
            Save
          </Button>
          {status && <span className="text-[12px] text-surface-500">{status}</span>}
        </div>
      </Card>

      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-[13px] font-semibold mr-auto">Preview &amp; Send</h3>
          <Input
            type="date"
            value={previewEnd}
            onChange={(e) => setPreviewEnd(e.target.value)}
            className="h-8 text-[12px] w-40"
            aria-label="Week ending"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => void runPreview()}
            disabled={previewing}
          >
            {previewing ? (
              <Loader2 className="w-4 h-4 animate-spin mr-1" />
            ) : (
              <Eye className="w-4 h-4 mr-1" />
            )}
            Preview
          </Button>
          <Button variant="outline" size="sm" onClick={downloadCsv} disabled={!preview}>
            <Download className="w-4 h-4 mr-1" /> CSV
          </Button>
          <Button size="sm" onClick={() => void sendNow()} disabled={sending}>
            {sending ? (
              <Loader2 className="w-4 h-4 animate-spin mr-1" />
            ) : (
              <Send className="w-4 h-4 mr-1" />
            )}
            Send now
          </Button>
        </div>
        {preview && (
          <div className="space-y-3">
            <p className="text-[12px] text-surface-500">
              {preview.window.start} to {preview.window.end} · {fmtHours(preview.totalMinutes)}h ·{' '}
              <Money>{formatUsd(preview.totalAmount)}</Money>
            </p>
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-surface-500">
                  <th className="py-1 pr-2 font-medium">Category</th>
                  <th className="py-1 pr-2 font-medium text-right">Hours</th>
                  <th className="py-1 font-medium text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {preview.categories.map((c) => (
                  <tr key={c.category} className="border-t border-border">
                    <td className="py-1 pr-2">{c.category}</td>
                    <td className="py-1 pr-2 text-right">{fmtHours(c.minutes)}</td>
                    <td className="py-1 text-right">
                      <Money>{formatUsd(c.amount)}</Money>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="max-h-80 overflow-y-auto border border-border rounded-lg">
              <table className="w-full text-[12px]">
                <thead className="sticky top-0 bg-surface-50">
                  <tr className="text-left text-surface-500">
                    <th className="py-1 px-2 font-medium">Date</th>
                    <th className="py-1 px-2 font-medium">Category</th>
                    <th className="py-1 px-2 font-medium">Description</th>
                    <th className="py-1 px-2 font-medium text-right">Hours</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r, i) => (
                    <tr key={i} className="border-t border-border align-top">
                      <td className="py-1 px-2 whitespace-nowrap">{r.date}</td>
                      <td className="py-1 px-2 whitespace-nowrap">{r.category}</td>
                      <td className="py-1 px-2">
                        {r.description || r.project}
                        {r.billable ? '' : ' (non-billable)'}
                      </td>
                      <td className="py-1 px-2 text-right">{fmtHours(r.minutes)}</td>
                    </tr>
                  ))}
                  {preview.rows.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-3 px-2 text-center text-surface-500">
                        No entries in this window.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
