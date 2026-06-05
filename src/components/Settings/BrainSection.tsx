// Brain — DocVault's user-owned long-term memory for the chat assistant.
//
// A single markdown document that is included in EVERY chat, so the assistant
// remembers durable facts, preferences, and decisions across conversations.
// Unlike External Sources (read-only git clones), the brain is DocVault's own
// store: it lives in the data dir, ships with every install, and the chat can
// append to it with the `remember` tool. Edit it freely here.

import { useEffect, useState } from 'react';
import { Brain, Save, Trash2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '../../hooks/useToast';
import { useConfirmDialog } from '../../hooks/useConfirmDialog';
import { API_BASE } from '../../constants';

interface BrainState {
  content: string;
  bytes: number;
  updatedAt: string | null;
  exists: boolean;
}

function formatWhen(iso: string | null): string {
  if (!iso) return 'never';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'never' : d.toLocaleString();
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  return `${(n / 1024).toFixed(1)} KB`;
}

export function BrainSection() {
  const { addToast } = useToast();
  const { confirm, ConfirmDialog } = useConfirmDialog();
  const [content, setContent] = useState('');
  const [saved, setSaved] = useState('');
  const [meta, setMeta] = useState<BrainState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/brain`);
      const data: BrainState = await res.json();
      setContent(data.content);
      setSaved(data.content);
      setMeta(data);
    } catch {
      addToast('Failed to load brain', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dirty = content !== saved;

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/brain`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) throw new Error('save failed');
      const data: BrainState = await res.json();
      setContent(data.content);
      setSaved(data.content);
      setMeta(data);
      addToast('Brain saved', 'success');
    } catch {
      addToast('Failed to save brain', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function clearBrain() {
    const ok = await confirm({
      title: 'Clear the brain?',
      description:
        'This erases everything in your long-term memory. The chat will no longer recall any of it. This cannot be undone.',
      confirmLabel: 'Clear brain',
      destructive: true,
    });
    if (!ok) return;
    setContent('');
    // Persist immediately so an accidental navigate-away doesn't leave a stale brain.
    try {
      const res = await fetch(`${API_BASE}/brain`, { method: 'DELETE' });
      if (!res.ok) throw new Error('clear failed');
      const data: BrainState = await res.json();
      setSaved(data.content);
      setMeta(data);
      addToast('Brain cleared', 'success');
    } catch {
      addToast('Failed to clear brain', 'error');
    }
  }

  if (loading) {
    return (
      <Card variant="glass" className="p-6 mb-8">
        <div className="text-center py-4 text-surface-600">Loading…</div>
      </Card>
    );
  }

  return (
    <Card variant="glass" className="p-6 mb-8">
      <h3 className="text-lg font-semibold text-surface-950 mb-1 flex items-center gap-2">
        <Brain className="w-5 h-5" />
        Brain
      </h3>
      <p className="text-[12px] text-surface-600 mb-4">
        Long-term memory for the chat assistant — a single markdown note included in{' '}
        <span className="font-medium">every</span> conversation. Add durable facts, preferences, and
        decisions you want remembered. The chat can also append to it with the{' '}
        <code className="px-1 py-0.5 rounded bg-surface-200 text-[11px]">remember</code> tool. Skip
        anything the app already stores (balances, document contents, lab values).
      </p>

      <Textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={16}
        spellCheck={false}
        placeholder={
          '# DocVault Brain\n\n## Notes\n\n- (2026-06-04, preference) I prefer concise answers with sources.'
        }
        className="font-mono text-[12px] leading-relaxed"
      />

      <div className="flex items-center justify-between mt-3">
        <p className="text-[11px] text-surface-500">
          {formatBytes(meta?.bytes ?? new Blob([content]).size)} · updated{' '}
          {formatWhen(meta?.updatedAt ?? null)}
          {dirty && <span className="ml-2 text-accent-600">• unsaved changes</span>}
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setContent(saved);
            }}
            disabled={!dirty || saving}
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Revert
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={clearBrain}
            disabled={saving || (!content && !saved)}
          >
            <Trash2 className="w-3.5 h-3.5" />
            Clear
          </Button>
          <Button size="sm" onClick={save} disabled={!dirty || saving}>
            <Save className="w-3.5 h-3.5" />
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>

      <ConfirmDialog />
    </Card>
  );
}
