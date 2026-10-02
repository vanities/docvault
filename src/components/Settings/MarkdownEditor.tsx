import { useId, useState } from 'react';
import { Eye, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { SafeMarkdown } from '../common/SafeMarkdown';

export function MarkdownEditor({
  label,
  value,
  onChange,
  disabled,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const id = useId();
  const [preview, setPreview] = useState(false);
  return (
    <div className="min-w-0 overflow-hidden rounded-xl border border-border/60 bg-surface-50/40">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 p-2">
        <label htmlFor={id} className="px-2 text-sm font-medium text-surface-800">
          {label}
        </label>
        <div className="flex gap-1" role="group" aria-label={`${label} mode`}>
          <Button
            type="button"
            variant={preview ? 'ghost' : 'secondary'}
            className="h-11 text-surface-900"
            aria-pressed={!preview}
            onClick={() => setPreview(false)}
          >
            <Pencil className="size-4" />
            Edit
          </Button>
          <Button
            type="button"
            variant={preview ? 'secondary' : 'ghost'}
            className="h-11 text-surface-900"
            aria-pressed={preview}
            onClick={() => setPreview(true)}
          >
            <Eye className="size-4" />
            Preview
          </Button>
        </div>
      </div>
      {preview ? (
        <div
          role="region"
          aria-label={`${label} preview`}
          className="min-h-64 max-h-[60vh] overflow-auto p-4 text-sm leading-relaxed text-surface-900 [overflow-wrap:anywhere] [&_h1]:mb-4 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:my-3 [&_h2]:text-lg [&_h2]:font-semibold [&_p]:my-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_pre]:overflow-auto [&_pre]:rounded-lg [&_pre]:bg-surface-200/50 [&_pre]:p-3 [&_table]:block [&_table]:overflow-auto [&_td]:border [&_td]:border-border [&_td]:p-2 [&_th]:p-2"
        >
          {value.trim() ? (
            <SafeMarkdown>{value}</SafeMarkdown>
          ) : (
            <p className="text-surface-800">
              Nothing to preview yet. Switch to Edit to start writing.
            </p>
          )}
        </div>
      ) : (
        <Textarea
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          placeholder={placeholder}
          rows={12}
          spellCheck={false}
          className="min-h-64 rounded-none border-0 bg-transparent p-4 font-mono text-base leading-relaxed shadow-none sm:text-sm"
        />
      )}
    </div>
  );
}
