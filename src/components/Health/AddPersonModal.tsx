// Add Person dialog for the Health view.
// Creates a new HealthPerson via POST /api/health/people, and optionally
// uploads + parses an export.zip in the same flow so users can go from
// "nothing" to "parsed dashboard" in one submit.

import { useState, useEffect, useRef } from 'react';
import { FileArchive, Upload, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';

interface AddPersonModalProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * Called when the user submits. If `file` is provided, the caller should
   * create the person AND upload + parse the file in one flow; otherwise
   * just create the person.
   */
  onCreate: (name: string, color: string, file: File | null) => Promise<void>;
}

const COLOR_OPTIONS = ['rose', 'blue', 'emerald', 'amber', 'violet', 'cyan'] as const;

const COLOR_CLASSES: Record<(typeof COLOR_OPTIONS)[number], string> = {
  rose: 'bg-rose-500',
  blue: 'bg-blue-500',
  emerald: 'bg-emerald-500',
  amber: 'bg-amber-500',
  violet: 'bg-violet-500',
  cyan: 'bg-cyan-500',
};

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function AddPersonModal({ isOpen, onClose, onCreate }: AddPersonModalProps) {
  const [name, setName] = useState('');
  const [color, setColor] = useState<(typeof COLOR_OPTIONS)[number]>('rose');
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setName('');
      setColor('rose');
      setFile(null);
      setSubmitting(false);
    }
  }, [isOpen]);

  const handleSubmit = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      await onCreate(trimmed, color, file);
    } finally {
      setSubmitting(false);
    }
  };

  const busyLabel = file ? 'Uploading & parsing…' : 'Creating…';

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !submitting && onClose()}>
      <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Person</DialogTitle>
          <DialogDescription>
            Each person has their own upload area and parsed dashboards. You can optionally upload
            their Apple Health export now — we&apos;ll unarchive and parse it automatically.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <label
              htmlFor="health-person-name"
              className="text-xs font-medium text-surface-700 uppercase tracking-wide"
            >
              Display Name
            </label>
            <Input
              id="health-person-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Alex"
              autoFocus
              className="mt-1.5"
              disabled={submitting}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && name.trim() && !submitting) {
                  void handleSubmit();
                }
              }}
            />
          </div>
          <div>
            <div className="text-xs font-medium text-surface-700 uppercase tracking-wide mb-2">
              Color
            </div>
            <div className="flex gap-2">
              {COLOR_OPTIONS.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  disabled={submitting}
                  onClick={() => setColor(opt)}
                  aria-label={opt}
                  className={`
                    w-8 h-8 rounded-full transition-all disabled:cursor-not-allowed
                    ${COLOR_CLASSES[opt]}
                    ${color === opt ? 'ring-2 ring-offset-2 ring-offset-surface-0 ring-accent-400' : 'opacity-60 hover:opacity-100'}
                  `}
                />
              ))}
            </div>
          </div>
          <div>
            <div className="text-xs font-medium text-surface-700 uppercase tracking-wide mb-1.5">
              Apple Health Export <span className="text-surface-500 normal-case">(optional)</span>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip,application/zip"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setFile(f);
                if (e.target) e.target.value = '';
              }}
            />
            {file ? (
              <div className="flex items-center gap-2 p-2 rounded-lg border border-accent-500/30 bg-accent-500/5">
                <FileArchive className="w-4 h-4 text-accent-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-mono truncate text-surface-950">{file.name}</div>
                  <div className="text-[11px] text-surface-600">{formatBytes(file.size)}</div>
                </div>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => setFile(null)}
                  aria-label="Remove file"
                  className="p-1 text-surface-600 hover:text-surface-900 disabled:opacity-40"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={submitting}
                onClick={() => fileInputRef.current?.click()}
                className="w-full flex items-center justify-center gap-2 p-3 rounded-lg border border-dashed border-border hover:border-accent-500/40 text-sm text-surface-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Upload className="w-4 h-4" />
                Choose export.zip
              </button>
            )}
            <p className="text-[11px] text-surface-600 mt-1.5 leading-relaxed">
              On iPhone: Health → profile picture → <strong>Export All Health Data</strong>. Share
              the zip to this machine, then select it above.
            </p>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!name.trim() || submitting}>
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                {busyLabel}
              </>
            ) : file ? (
              'Create & Parse'
            ) : (
              'Create'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
