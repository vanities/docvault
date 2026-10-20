import { useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { AlertSettingSpec } from '../../../server/alerts-types';
import {
  diffSettings,
  formatSetting,
  parseSettingInput,
  settingValue,
  type SettingChange,
} from './alerts';

/**
 * Inline editor for the numbers a source's job declared. Done lists every change (old → new)
 * in a confirm dialog before anything is saved, the same flow as editing a property.
 */
export function AlertSettingsForm({
  sourceLabel,
  specs,
  values,
  saving,
  onCancel,
  onSave,
}: {
  sourceLabel: string;
  specs: AlertSettingSpec[];
  values: Record<string, number> | undefined;
  saving: boolean;
  onCancel: () => void;
  /** Resolves true once saved; the dialog stays open on failure so nothing typed is lost. */
  onSave: (changes: SettingChange[]) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(specs.map((s) => [s.key, String(settingValue(s, values))]))
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<SettingChange[] | null>(null);

  const done = () => {
    const next: Record<string, number> = {};
    const found: Record<string, string> = {};
    for (const spec of specs) {
      const parsed = parseSettingInput(spec, draft[spec.key] ?? '');
      if ('error' in parsed) found[spec.key] = parsed.error;
      else next[spec.key] = parsed.value;
    }
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    const changes = diffSettings(specs, values, next);
    if (changes.length === 0) onCancel();
    else setPending(changes);
  };

  return (
    <div className="rounded-xl border border-border/40 p-3 space-y-3">
      <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
        {specs.map((spec) => {
          const id = `alert-setting-${spec.key}`;
          const error = errors[spec.key];
          const atDefault = (draft[spec.key] ?? '').trim() === String(spec.default);
          return (
            <div key={spec.key} className="space-y-1 min-w-0">
              <label htmlFor={id} className="block text-[12px] font-medium text-surface-900">
                {spec.label}
              </label>
              <div className="flex items-center gap-2">
                {spec.unit === '$' && <span className="text-[13px] text-surface-600">$</span>}
                <Input
                  id={id}
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={draft[spec.key] ?? ''}
                  aria-invalid={error ? true : undefined}
                  onChange={(e) => setDraft((d) => ({ ...d, [spec.key]: e.target.value }))}
                  className={`h-9 max-w-[9rem] font-mono ${error ? 'border-danger-400' : ''}`}
                />
                {spec.unit && spec.unit !== '$' && (
                  <span className="text-[12px] text-surface-600">{spec.unit}</span>
                )}
                {!atDefault && (
                  <button
                    type="button"
                    className="text-[11px] text-surface-600 hover:text-surface-950"
                    onClick={() => setDraft((d) => ({ ...d, [spec.key]: String(spec.default) }))}
                  >
                    Use default
                  </button>
                )}
              </div>
              {error ? (
                <p className="text-[11px] text-danger-400">{error}</p>
              ) : (
                <p className="text-[11px] text-surface-600">
                  {spec.help ? `${spec.help} ` : ''}Default {formatSetting(spec, spec.default)}.
                </p>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button size="sm" onClick={done} disabled={saving}>
          Done
        </Button>
      </div>

      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open && !saving) setPending(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Save these changes?</AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.length === 1
                ? '1 setting changes'
                : `${pending?.length ?? 0} settings change`}{' '}
              on {sourceLabel}. It checks again right away with the new values.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="space-y-1.5 text-sm">
            {pending?.map((c) => (
              <li key={c.key} className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-surface-600">{c.label}:</span>
                <span className="text-surface-500 line-through">{c.from}</span>
                <span className="text-surface-400">→</span>
                <span className="font-medium text-surface-950">
                  {c.to}
                  {c.value === null ? ' (default)' : ''}
                </span>
              </li>
            ))}
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              disabled={saving}
              onClick={(e) => {
                e.preventDefault();
                if (!pending) return;
                void onSave(pending).then((ok) => {
                  if (ok) setPending(null);
                });
              }}
              className="bg-emerald-600 hover:bg-emerald-500 text-white"
            >
              {saving ? 'Saving…' : 'Yes, save'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
