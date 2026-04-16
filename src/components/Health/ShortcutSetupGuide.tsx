// Per-person Shortcut setup guide. Fetches the person's ingest URL +
// auth token + metric list from /api/health/:personId/shortcut-config and
// renders a copy-paste-friendly step-by-step walkthrough for building the
// iOS Shortcut that POSTs daily health data to DocVault.
//
// The guide is additive: it appears at the bottom of PersonDetail only
// after there's at least one parsed export for that person. Before you
// have any data you don't need a daily delta flow — the bulk import is
// the first step.

import { useEffect, useState } from 'react';
import { Smartphone, Copy, Check, Workflow, Shield, Eye, EyeOff, Info } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { API_BASE } from '../../constants';

interface ShortcutMetric {
  hkType: string;
  healthAppName: string;
  aggregate: string;
}

interface ShortcutConfig {
  personId: string;
  ingestUrl: string;
  shortcutDownloadUrl: string;
  authHeader: string;
  authToken: string;
  scheduleTime: string;
  metrics: ShortcutMetric[];
}

interface ShortcutSetupGuideProps {
  personId: string;
  personName: string;
}

/** Small hook-free helper for "click to copy → show checkmark" behavior. */
function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (value: string, key: string) => {
    // navigator.clipboard requires HTTPS on modern browsers, so fall back to
    // the old execCommand approach on HTTP (Unraid LAN case).
    try {
      void navigator.clipboard.writeText(value);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = value;
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
  };
  return { copied, copy };
}

export function ShortcutSetupGuide({ personId, personName }: ShortcutSetupGuideProps) {
  const [config, setConfig] = useState<ShortcutConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);
  const { copied, copy } = useCopy();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`${API_BASE}/health/${personId}/shortcut-config`)
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return res.json();
      })
      .then((c: ShortcutConfig) => {
        if (!cancelled) {
          setConfig(c);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [personId]);

  if (loading) return null;
  if (error || !config) return null;

  const maskedToken =
    '•'.repeat(Math.max(8, config.authToken.length - 4)) + config.authToken.slice(-4);
  const displayToken = showToken ? config.authToken : maskedToken;

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 mb-4">
        <Smartphone className="w-5 h-5 text-accent-400" />
        <h3 className="font-medium text-surface-950">Daily sync from iPhone</h3>
      </div>
      <p className="text-sm text-surface-700 mb-4 leading-relaxed">
        Want today&apos;s data to show up in {personName}&apos;s dashboard automatically? Build a
        Shortcut on the iPhone and schedule it to run at{' '}
        <strong>{config.scheduleTime} daily</strong>. DocVault will overlay the shortcut&apos;s
        values on top of the bulk export so you always see the freshest data without re-exporting
        and re-uploading.
      </p>

      {/* Download .shortcut file — experimental */}
      <Card className="p-4 mb-5 border-accent-500/20 bg-accent-500/5">
        <div className="flex items-start gap-3">
          <Smartphone className="w-5 h-5 text-accent-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="font-medium text-surface-950 mb-1">Download the pre-built shortcut</div>
            <p className="text-xs text-surface-700 mb-2">
              Download the signed shortcut file, AirDrop it to your iPhone, and import it. After
              importing, open it in the Shortcuts editor and update two things: (1) tap the{' '}
              <strong>Get Contents of URL</strong> action and replace the URL with your Ingest URL
              from above, and (2) replace the{' '}
              <code className="font-mono text-[11px]">X-Docvault-Auth</code> header value with your
              token from above.
            </p>
            <div className="flex items-center gap-3">
              <a
                href={config.shortcutDownloadUrl}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent-500/15 text-accent-400 text-sm font-medium hover:bg-accent-500/25 transition-colors"
              >
                <Smartphone className="w-3.5 h-3.5" />
                Download .shortcut file
              </a>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 gap-1"
                onClick={() => copy(config.shortcutDownloadUrl, 'shortcut-url')}
              >
                {copied === 'shortcut-url' ? (
                  <Check className="w-3.5 h-3.5" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                Copy URL
              </Button>
            </div>
          </div>
        </div>
      </Card>

      {/* Config panel — users need these values to edit the shortcut after import */}
      <div className="space-y-2 mb-4">
        <ConfigRow
          icon={Workflow}
          label="Ingest URL"
          value={config.ingestUrl}
          copyKey="url"
          copied={copied}
          onCopy={copy}
          mono
        />
        <ConfigRow
          icon={Shield}
          label={config.authHeader}
          value={displayToken}
          copyValue={config.authToken}
          copyKey="token"
          copied={copied}
          onCopy={copy}
          mono
          trailing={
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              onClick={() => setShowToken((v) => !v)}
              title={showToken ? 'Hide token' : 'Show token'}
            >
              {showToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </Button>
          }
        />
      </div>

      {/* After import: schedule + settings */}
      <div className="text-sm text-surface-700 space-y-3 mb-4">
        <p>
          <strong>After importing:</strong> open the shortcut in the editor, tap{' '}
          <strong>Get Contents of URL</strong>, and replace the URL and{' '}
          <code className="font-mono text-[11px]">X-Docvault-Auth</code> token with the values
          above.
        </p>
        <p>
          <strong>Schedule it:</strong> go to <strong>Automation</strong> tab → <strong>New</strong>{' '}
          → <strong>Time of Day</strong> → <strong>{config.scheduleTime}</strong> →{' '}
          <strong>Daily</strong> → pick this shortcut → enable <strong>Run Immediately</strong>.
        </p>
        <p>
          <strong>First run:</strong> iOS will prompt{' '}
          <em>&ldquo;This shortcut is about to share a large amount of data&rdquo;</em> — tap Allow.
          To suppress this for automated runs, go to{' '}
          <strong>Settings → Shortcuts → Advanced → Allow Sharing Large Amounts of Data</strong>.
        </p>
      </div>

      {/* Troubleshooting */}
      <Card className="p-3 border-accent-500/20 bg-accent-500/5">
        <div className="flex items-start gap-2 text-xs">
          <Info className="w-4 h-4 text-accent-400 flex-shrink-0 mt-0.5" />
          <div className="text-surface-700">
            <strong className="text-surface-950">
              Can&apos;t reach DocVault from outside your LAN?
            </strong>{' '}
            You need WireGuard On-Demand on your iPhone or a reverse-proxy exposing DocVault with
            HTTPS. The shortcut just needs the URL above to resolve to your NAS.
          </div>
        </div>
      </Card>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Small sub-components
// ---------------------------------------------------------------------------

function ConfigRow({
  icon: Icon,
  label,
  value,
  copyValue,
  copyKey,
  copied,
  onCopy,
  mono,
  trailing,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  copyValue?: string;
  copyKey: string;
  copied: string | null;
  onCopy: (value: string, key: string) => void;
  mono?: boolean;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 p-2 rounded-lg border border-border bg-surface-100/40">
      <Icon className="w-4 h-4 text-surface-500 flex-shrink-0" />
      <div className="text-[10px] uppercase tracking-wide text-surface-600 w-28 flex-shrink-0">
        {label}
      </div>
      <div
        className={`flex-1 min-w-0 truncate text-sm text-surface-950 ${mono ? 'font-mono' : ''}`}
      >
        {value}
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2 gap-1 flex-shrink-0"
        onClick={() => onCopy(copyValue ?? value, copyKey)}
        title="Copy to clipboard"
      >
        {copied === copyKey ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      </Button>
      {trailing}
    </div>
  );
}
