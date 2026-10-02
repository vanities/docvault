import { useCallback, useEffect, useState } from 'react';
import { Brain, Save, Trash2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useToast } from '../../hooks/useToast';
import { useConfirmDialog } from '../../hooks/useConfirmDialog';
import { useUnsavedChanges } from '../../hooks/useUnsavedChanges';
import { API_BASE } from '../../constants';
import { requestJson } from '../../api/client';
import { MarkdownEditor } from './MarkdownEditor';

interface BrainState {
  content: string;
  bytes: number;
  updatedAt: string | null;
  exists: boolean;
}

export function BrainSection() {
  const { addToast } = useToast();
  const { confirm, confirmDialog } = useConfirmDialog();
  const [content, setContent] = useState('');
  const [saved, setSaved] = useState('');
  const [meta, setMeta] = useState<BrainState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const dirty = content !== saved;
  useUnsavedChanges(dirty, saving);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const data = await requestJson<BrainState>(`${API_BASE}/brain`);
      setContent(data.content);
      setSaved(data.content);
      setMeta(data);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function persist(clear = false) {
    setSaving(true);
    try {
      const data = await requestJson<BrainState>(
        `${API_BASE}/brain`,
        clear
          ? { method: 'DELETE' }
          : {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ content }),
            }
      );
      setContent(data.content);
      setSaved(data.content);
      setMeta(data);
      addToast(clear ? 'Brain cleared' : 'Brain saved', 'success');
    } catch {
      addToast(
        clear
          ? 'Could not clear Brain. Your text has been kept.'
          : 'Could not save Brain. Your edits have been kept.',
        'error'
      );
    } finally {
      setSaving(false);
    }
  }

  async function clearBrain() {
    if (
      await confirm({
        title: 'Clear the brain?',
        description:
          'This permanently removes the memory used in every chat. This cannot be undone.',
        confirmLabel: 'Clear brain',
        destructive: true,
      })
    )
      await persist(true);
  }

  return (
    <Card variant="glass" className="mb-6 min-w-0 p-4 sm:p-6">
      <h3 className="flex items-center gap-2 text-lg font-semibold text-surface-950">
        <Brain className="size-5" />
        Brain
      </h3>
      <p className="mt-2 mb-5 text-sm leading-relaxed text-surface-800">
        The memory your assistant uses in every conversation. Keep durable facts, preferences and
        decisions here.
      </p>
      {loading ? (
        <p role="status" className="py-8 text-center text-sm text-surface-800">
          Loading memory…
        </p>
      ) : error ? (
        <div role="alert" className="rounded-lg border border-danger-500/30 p-4">
          <p className="mb-3 text-sm">Memory could not be loaded.</p>
          <Button variant="outline" onClick={() => void load()}>
            Try again
          </Button>
        </div>
      ) : (
        <>
          <MarkdownEditor
            label="Memory"
            value={content}
            onChange={setContent}
            disabled={saving}
            placeholder="# Assistant memory\n\nAdd your preferences and decisions…"
          />
          <div
            className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-surface-800"
            role="status"
          >
            <span>{new Blob([content]).size.toLocaleString()} bytes</span>
            <span>
              {meta?.updatedAt
                ? `Updated ${new Date(meta.updatedAt).toLocaleString()}`
                : 'Not saved yet'}
            </span>
            {dirty && <span className="font-medium text-accent-400">Unsaved changes</span>}
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-border/40 pt-4">
            <Button
              variant="ghost-danger"
              className="h-11"
              onClick={() => void clearBrain()}
              disabled={saving || (!content && !saved)}
            >
              <Trash2 className="size-4" />
              Clear
            </Button>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                className="h-11"
                onClick={() => setContent(saved)}
                disabled={!dirty || saving}
              >
                <RotateCcw className="size-4" />
                Revert
              </Button>
              <Button className="h-11" onClick={() => void persist()} disabled={!dirty || saving}>
                <Save className="size-4" />
                {saving ? 'Saving…' : 'Save memory'}
              </Button>
            </div>
          </div>
        </>
      )}
      {confirmDialog}
    </Card>
  );
}
