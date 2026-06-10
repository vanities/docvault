// Skills — user-authored instruction packs the Chat assistant can invoke.
//
// Each skill is a SKILL.md folder under DATA_DIR/skills/<name>/ (gitignored,
// user-owned — same home as custom jobs). The Claude chat backend loads them
// per turn and the composer suggests them when you type `$`. A skill is pure
// instructions: a short description (so the model knows when it applies) plus
// a markdown body with the steps/format you want followed.

import { useEffect, useState } from 'react';
import { GraduationCap, Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '../../hooks/useToast';
import { useConfirmDialog } from '../../hooks/useConfirmDialog';
import { API_BASE } from '../../constants';
import { requestJson } from '../../api/client';

interface SkillSummary {
  name: string;
  description: string;
  bytes: number;
  updatedAt: string | null;
}

interface SkillRecord extends SkillSummary {
  instructions: string;
}

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

function formatWhen(iso: string | null): string {
  if (!iso) return 'never';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'never' : d.toLocaleString();
}

export function SkillsSection() {
  const { addToast } = useToast();
  const { confirm, ConfirmDialog } = useConfirmDialog();
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [loading, setLoading] = useState(true);

  // Editor state — null means the editor is closed. `isNew` keeps the name
  // editable only while creating (renames would orphan the old folder).
  const [editor, setEditor] = useState<{
    isNew: boolean;
    name: string;
    description: string;
    instructions: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const data = await requestJson<{ skills: SkillSummary[] }>(`${API_BASE}/skills`);
      setSkills(data.skills);
    } catch {
      addToast('Failed to load skills', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openEdit(name: string) {
    try {
      const skill = await requestJson<SkillRecord>(
        `${API_BASE}/skills/${encodeURIComponent(name)}`
      );
      setEditor({
        isNew: false,
        name: skill.name,
        description: skill.description,
        instructions: skill.instructions,
      });
    } catch {
      addToast(`Failed to load skill "${name}"`, 'error');
    }
  }

  async function save() {
    if (!editor) return;
    const name = editor.name.trim();
    if (!NAME_RE.test(name)) {
      addToast('Name must be kebab-case: lowercase letters, digits, hyphens', 'error');
      return;
    }
    if (editor.isNew && skills.some((s) => s.name === name)) {
      addToast(`A skill named "${name}" already exists`, 'error');
      return;
    }
    setSaving(true);
    try {
      await requestJson<SkillRecord>(`${API_BASE}/skills/${encodeURIComponent(name)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: editor.description,
          instructions: editor.instructions,
        }),
      });
      addToast(`Skill "${name}" saved`, 'success');
      setEditor(null);
      await load();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to save skill', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function remove(name: string) {
    const ok = await confirm({
      title: `Delete skill "${name}"?`,
      description: 'Removes the skill folder from the data dir. This cannot be undone.',
      confirmLabel: 'Delete skill',
      destructive: true,
    });
    if (!ok) return;
    try {
      await requestJson(`${API_BASE}/skills/${encodeURIComponent(name)}`, { method: 'DELETE' });
      addToast(`Skill "${name}" deleted`, 'success');
      await load();
    } catch {
      addToast('Failed to delete skill', 'error');
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
      <div className="flex items-start justify-between gap-2 mb-1">
        <h3 className="text-lg font-semibold text-surface-950 flex items-center gap-2">
          <GraduationCap className="w-5 h-5" />
          Skills
        </h3>
        {!editor && (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setEditor({ isNew: true, name: '', description: '', instructions: '' })}
          >
            <Plus className="w-3.5 h-3.5" />
            New skill
          </Button>
        )}
      </div>
      <p className="text-[12px] text-surface-600 mb-4">
        Reusable instruction packs for Chat — both backends (Claude invokes them as native skills;
        Codex gets them inlined into its instructions). Type{' '}
        <code className="px-1 py-0.5 rounded bg-surface-200 text-[11px]">$</code> in the composer to
        mention one — the assistant loads its instructions on demand. Stored as{' '}
        <code className="px-1 py-0.5 rounded bg-surface-200 text-[11px]">
          skills/&lt;name&gt;/SKILL.md
        </code>{' '}
        in the data dir.
      </p>

      {editor ? (
        <div className="space-y-3">
          <div>
            <label className="block text-[11px] text-surface-500 mb-1">
              Name (kebab-case — becomes the $mention)
            </label>
            <Input
              type="text"
              value={editor.name}
              disabled={!editor.isNew}
              onChange={(e) =>
                setEditor({ ...editor, name: e.target.value.toLowerCase().replace(/\s+/g, '-') })
              }
              placeholder="tax-doc-review"
              className="text-[13px] font-mono"
            />
          </div>
          <div>
            <label className="block text-[11px] text-surface-500 mb-1">
              Description (one line — tells the model when this skill applies)
            </label>
            <Input
              type="text"
              value={editor.description}
              onChange={(e) => setEditor({ ...editor, description: e.target.value })}
              placeholder="Review a tax document for missing or inconsistent fields"
              className="text-[13px]"
            />
          </div>
          <div>
            <label className="block text-[11px] text-surface-500 mb-1">
              Instructions (markdown — the steps, format, and rules to follow)
            </label>
            <Textarea
              value={editor.instructions}
              onChange={(e) => setEditor({ ...editor, instructions: e.target.value })}
              rows={12}
              spellCheck={false}
              placeholder={
                '# Tax doc review\n\n1. Read the document with the read_file tool.\n2. Check totals against the tax summary.\n3. Report discrepancies as a markdown table.'
              }
              className="font-mono text-[12px] leading-relaxed"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={() => void save()} size="sm" disabled={saving}>
              <Save className="w-4 h-4" />
              {saving ? 'Saving…' : 'Save skill'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setEditor(null)} disabled={saving}>
              <X className="w-4 h-4" />
              Cancel
            </Button>
          </div>
        </div>
      ) : skills.length === 0 ? (
        <p className="text-[12px] text-surface-500">
          No skills yet. Create one to teach the chat a repeatable workflow — e.g. how to review a
          document, draft a summary in your format, or run a monthly checklist.
        </p>
      ) : (
        <div className="space-y-2">
          {skills.map((skill) => (
            <div
              key={skill.name}
              className="flex items-start justify-between gap-3 rounded-lg border border-border/40 bg-surface-100/40 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-[13px] font-mono font-medium text-surface-900">${skill.name}</p>
                <p className="text-[12px] text-surface-600 truncate">{skill.description}</p>
                <p className="text-[11px] text-surface-500 mt-0.5">
                  updated {formatWhen(skill.updatedAt)}
                </p>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => void openEdit(skill.name)}
                  title="Edit skill"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => void remove(skill.name)}
                  title="Delete skill"
                >
                  <Trash2 className="w-3.5 h-3.5 text-red-500/80" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
      <ConfirmDialog />
    </Card>
  );
}
