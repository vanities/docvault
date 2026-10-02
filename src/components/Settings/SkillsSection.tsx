import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, FileText, GraduationCap, Plus, Save, Search, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useToast } from '../../hooks/useToast';
import { useConfirmDialog } from '../../hooks/useConfirmDialog';
import { useUnsavedChanges } from '../../hooks/useUnsavedChanges';
import { API_BASE } from '../../constants';
import { requestJson } from '../../api/client';
import { MarkdownEditor } from './MarkdownEditor';

interface SkillSummary {
  name: string;
  description: string;
  bytes: number;
  updatedAt: string | null;
}
interface SkillRecord extends SkillSummary {
  instructions: string;
}
interface Editor {
  isNew: boolean;
  name: string;
  description: string;
  instructions: string;
}
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function SkillsSection() {
  const { addToast } = useToast();
  const { confirm, confirmDialog } = useConfirmDialog();
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('name');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [original, setOriginal] = useState<Editor | null>(null);
  const [saving, setSaving] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const request = useRef(0);
  const dirty = JSON.stringify(editor) !== JSON.stringify(original);
  useUnsavedChanges(dirty, saving);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const data = await requestJson<{ skills: SkillSummary[] }>(`${API_BASE}/skills`);
      setSkills(data.skills);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
    return () => {
      // This is a request generation counter, not a DOM ref.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      request.current++;
    };
  }, [load]);

  async function canLeave() {
    return (
      !dirty ||
      confirm({
        title: 'Discard unsaved changes?',
        description: 'Your skill edits have not been saved.',
        confirmLabel: 'Discard changes',
        destructive: true,
      })
    );
  }
  async function open(name?: string) {
    if (saving || !(await canLeave())) return;
    const token = ++request.current;
    if (!name) {
      const next = { isNew: true, name: '', description: '', instructions: '' };
      setEditor(next);
      setOriginal(next);
      setOpening(null);
      return;
    }
    setOpening(name);
    try {
      const skill = await requestJson<SkillRecord>(
        `${API_BASE}/skills/${encodeURIComponent(name)}`
      );
      if (token !== request.current) return;
      const next = {
        isNew: false,
        name: skill.name,
        description: skill.description,
        instructions: skill.instructions,
      };
      setEditor(next);
      setOriginal(next);
    } catch {
      if (token === request.current) addToast(`Failed to load skill "${name}"`, 'error');
    } finally {
      if (token === request.current) setOpening(null);
    }
  }
  async function close() {
    if (saving || !(await canLeave())) return;
    request.current++;
    setOpening(null);
    setEditor(null);
    setOriginal(null);
  }
  async function save() {
    if (!editor) return;
    const name = editor.name.trim();
    if (!NAME_RE.test(name)) {
      addToast(
        'Use 1–64 lowercase letters, digits or hyphens. Start with a letter or digit.',
        'error'
      );
      return;
    }
    if (editor.isNew && skills.some((s) => s.name === name)) {
      addToast(`A skill named "${name}" already exists`, 'error');
      return;
    }
    setSaving(true);
    try {
      const skill = await requestJson<SkillRecord>(
        `${API_BASE}/skills/${encodeURIComponent(name)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            description: editor.description,
            instructions: editor.instructions,
          }),
        }
      );
      const next = {
        isNew: false,
        name: skill.name,
        description: skill.description,
        instructions: skill.instructions,
      };
      setEditor(next);
      setOriginal(next);
      setSkills((prev) => [...prev.filter((s) => s.name !== name), skill]);
      addToast(`Skill "${name}" saved`, 'success');
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : 'Could not save skill. Your edits have been kept.',
        'error'
      );
    } finally {
      setSaving(false);
    }
  }
  async function remove() {
    if (!editor || editor.isNew) return;
    const name = editor.name;
    if (
      !(await confirm({
        title: `Delete skill "${name}"?`,
        description:
          'This permanently removes this skill and its supporting files. This cannot be undone.',
        confirmLabel: 'Delete skill',
        destructive: true,
      }))
    )
      return;
    setSaving(true);
    try {
      await requestJson(`${API_BASE}/skills/${encodeURIComponent(name)}`, { method: 'DELETE' });
      setSkills((prev) => prev.filter((s) => s.name !== name));
      setEditor(null);
      setOriginal(null);
      addToast(`Skill "${name}" deleted`, 'success');
    } catch {
      addToast('Failed to delete skill', 'error');
    } finally {
      setSaving(false);
    }
  }
  const filtered = skills
    .filter((s) => `${s.name} ${s.description}`.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) =>
      sort === 'name'
        ? a.name.localeCompare(b.name)
        : (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')
    );

  return (
    <Card variant="glass" className="mb-6 min-w-0 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-lg font-semibold text-surface-950">
          <GraduationCap className="size-5" />
          Skills{' '}
          <span className="rounded-full bg-surface-200 px-2 py-0.5 text-xs text-surface-800">
            {skills.length}
          </span>
        </h3>
        <Button
          className="h-11"
          onClick={() => void open()}
          disabled={loading || error || saving || !!opening}
        >
          <Plus className="size-4" />
          New skill
        </Button>
      </div>
      <p className="mt-2 mb-5 text-sm text-surface-800">
        Reusable instructions for your assistant. Mention a skill with{' '}
        <span className="font-mono text-surface-800">$name</span> in chat.
      </p>
      {loading ? (
        <p role="status" className="py-8 text-center text-sm text-surface-800">
          Loading skills…
        </p>
      ) : error ? (
        <div role="alert" className="rounded-lg border border-danger-500/30 p-4">
          <p className="mb-3 text-sm">Skills could not be loaded.</p>
          <Button variant="outline" onClick={() => void load()}>
            Try again
          </Button>
        </div>
      ) : (
        <div className={`grid min-w-0 gap-5 ${editor ? 'xl:grid-cols-[210px_minmax(0,1fr)]' : ''}`}>
          <div className={`min-w-0 ${editor ? 'hidden xl:block' : ''}`}>
            <div className="relative mb-3">
              <Search className="absolute left-3 top-3.5 size-4 text-surface-800" />
              <Input
                aria-label="Search skills"
                placeholder="Search skills…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="h-11 text-base sm:text-sm placeholder:text-surface-800 pl-9"
              />
            </div>
            <label className="mb-3 flex items-center gap-2 text-xs text-surface-800">
              Sort by
              <select
                aria-label="Sort skills"
                value={sort}
                onChange={(event) => setSort(event.target.value)}
                className="h-10 min-w-0 flex-1 rounded-lg border border-border/50 bg-surface-50 px-2 text-sm text-surface-800"
              >
                <option value="name">Name</option>
                <option value="updated">Recently updated</option>
              </select>
            </label>
            <div className="space-y-2 xl:max-h-[65vh] xl:overflow-y-auto" aria-label="Skill files">
              {filtered.map((skill) => (
                <button
                  type="button"
                  key={skill.name}
                  disabled={saving || !!opening}
                  onClick={() => void open(skill.name)}
                  aria-current={editor?.name === skill.name ? 'true' : undefined}
                  className={`w-full rounded-xl border p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 ${editor?.name === skill.name ? 'border-accent-500/50 bg-accent-500/10' : 'border-border/50 bg-surface-100/40 hover:bg-surface-200/50'}`}
                >
                  <span className="flex items-start gap-2 text-sm font-medium text-surface-900">
                    <FileText className="mt-0.5 size-4 shrink-0 text-accent-400" />
                    <span className="[overflow-wrap:anywhere]">
                      {opening === skill.name ? 'Opening…' : skill.name}
                    </span>
                  </span>
                  <span className="mt-2 block text-xs leading-relaxed text-surface-800 [overflow-wrap:anywhere]">
                    {skill.description || 'No description'}
                  </span>
                  <span className="mt-2 block text-xs text-surface-800">
                    {skill.bytes.toLocaleString()} B
                    {skill.updatedAt ? ` · ${new Date(skill.updatedAt).toLocaleDateString()}` : ''}
                  </span>
                </button>
              ))}
              {filtered.length === 0 && (
                <div
                  role="status"
                  className="rounded-xl border border-dashed border-border p-5 text-center text-sm text-surface-800"
                >
                  <FileText className="mx-auto mb-3 size-7 text-surface-800" />
                  <p>
                    {skills.length
                      ? 'No skills match your search.'
                      : 'No skills yet. Create a skill for a workflow you repeat.'}
                  </p>
                  {query && (
                    <Button variant="link" className="mt-2" onClick={() => setQuery('')}>
                      Clear search
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>
          {editor && (
            <div className="min-w-0 space-y-4" aria-label="Skill editor">
              <Button
                variant="ghost"
                className="h-11 px-0 text-surface-800"
                onClick={() => void close()}
                disabled={saving}
              >
                <ArrowLeft className="size-4" />
                Back to skills
              </Button>
              <div>
                <label
                  htmlFor="skill-name"
                  className="mb-1.5 block text-sm font-medium text-surface-800"
                >
                  Skill name
                </label>
                <Input
                  id="skill-name"
                  value={editor.name}
                  disabled={!editor.isNew || saving || !!opening}
                  onChange={(event) =>
                    setEditor({
                      ...editor,
                      name: event.target.value.toLowerCase().replace(/\s+/g, '-'),
                    })
                  }
                  placeholder="document-review"
                  className="h-11 font-mono text-base sm:text-sm"
                />
                <p className="mt-1.5 text-xs text-surface-800">
                  {editor.isNew
                    ? 'Lowercase letters, digits and hyphens. Up to 64 characters.'
                    : `Mention as $${editor.name} in chat.`}
                </p>
              </div>
              <div>
                <label
                  htmlFor="skill-description"
                  className="mb-1.5 block text-sm font-medium text-surface-800"
                >
                  Description
                </label>
                <Input
                  id="skill-description"
                  value={editor.description}
                  disabled={saving || !!opening}
                  onChange={(event) => setEditor({ ...editor, description: event.target.value })}
                  placeholder="When should the assistant use this skill?"
                  className="h-11 text-base sm:text-sm"
                />
              </div>
              <MarkdownEditor
                key={editor.isNew ? 'new' : editor.name}
                label="Instructions"
                value={editor.instructions}
                onChange={(instructions) => setEditor({ ...editor, instructions })}
                disabled={saving || !!opening}
                placeholder="# Instructions"
              />
              <div role="status" className="text-xs text-surface-800">
                {dirty ? 'Unsaved changes' : editor.isNew ? 'New skill' : 'All changes saved'}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/40 pt-4">
                {!editor.isNew && (
                  <Button
                    variant="ghost-danger"
                    className="h-11"
                    disabled={saving || !!opening}
                    onClick={() => void remove()}
                  >
                    <Trash2 className="size-4" />
                    Delete skill
                  </Button>
                )}
                <Button
                  className="h-11"
                  disabled={saving || !!opening || !editor.name.trim() || (!editor.isNew && !dirty)}
                  onClick={() => void save()}
                >
                  <Save className="size-4" />
                  {saving ? 'Saving…' : 'Save skill'}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
      {confirmDialog}
    </Card>
  );
}
