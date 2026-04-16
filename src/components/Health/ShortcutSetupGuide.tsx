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
import { Smartphone, Copy, Check, Workflow, Clock, Shield, Eye, EyeOff, Info } from 'lucide-react';
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

  // Pre-built JSON body template the user can paste into the Shortcut's "Text" action
  const jsonTemplate = `{
  "date": "__DATE__",
  "source": "shortcut-v1",
  "metrics": {
${config.metrics
  .map((m) => {
    if (m.hkType === 'HeartRate') {
      return `    "HeartRate": {"min": __HR_MIN__, "max": __HR_MAX__, "avg": __HR_AVG__, "count": __HR_COUNT__}`;
    }
    if (m.hkType === 'RestingHeartRate') {
      return `    "RestingHeartRate": {"last": __RHR__}`;
    }
    if (m.hkType === 'HeartRateVariabilitySDNN') {
      return `    "HeartRateVariabilitySDNN": {"avg": __HRV__}`;
    }
    if (m.hkType === 'AppleStandHour') {
      return `    "AppleStandHour": {"count": __STAND_COUNT__}`;
    }
    const key = m.hkType;
    const varName = `__${m.hkType.replace(/[A-Z]/g, (c, i) => (i === 0 ? c : '_' + c)).toUpperCase()}__`;
    return `    "${key}": {"sum": ${varName}}`;
  })
  .join(',\n')}
  }
}`;

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

      {/* Quick-reference config panel */}
      <div className="space-y-2 mb-5">
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
        <ConfigRow
          icon={Clock}
          label="Schedule"
          value={`${config.scheduleTime} daily (your local time)`}
          copyKey="schedule"
          copied={copied}
          onCopy={copy}
        />
      </div>

      {/* Step 1 — Open Shortcuts and create new */}
      <Step
        number={1}
        title="Open Shortcuts app and create a new shortcut"
        body={
          <>
            <p>
              Tap the <strong>+</strong> button in the top right of the Shortcuts app. Name it
              something like <code className="font-mono text-[11px]">Sync Health → DocVault</code>.
            </p>
            <p className="text-xs text-surface-600 mt-2">
              Nothing to enable in Settings first — shortcuts you build yourself inside the app are
              automatically trusted. The old &ldquo;Allow Untrusted Shortcuts&rdquo; toggle only
              applied to importing shortcuts from outside iCloud, and Apple removed it in iOS 15+
              anyway.
            </p>
          </>
        }
      />

      {/* Step 2 — Current Date */}
      <Step
        number={2}
        title="Add a Current Date action"
        body={
          <p>
            Tap <strong>Add Action</strong>, search for <strong>Current Date</strong>, and add it.
            This becomes your date reference for the rest of the actions.
          </p>
        }
      />

      {/* Step 3 — one line per metric */}
      <Step
        number={3}
        title={`Add a Find Health Samples action for each of the ${config.metrics.length} metrics`}
        body={
          <>
            <p className="mb-2">
              For each metric below, add one <strong>Find Health Samples</strong> action (search for
              it in the action picker), set the Type, set the date to <strong>Today</strong>, then
              drag in a <strong>Calculate Statistics</strong> action right after it with the
              aggregation shown:
            </p>
            <div className="space-y-1">
              {config.metrics.map((m, i) => (
                <div
                  key={m.hkType}
                  className="flex items-start gap-2 p-2 rounded bg-surface-100/40 text-xs"
                >
                  <span className="text-surface-500 font-mono w-5">{i + 1}.</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-surface-950">{m.healthAppName}</div>
                    <div className="text-surface-600">
                      Aggregation: <span className="font-mono">{m.aggregate}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        }
      />

      {/* Step 4 — build the JSON */}
      <Step
        number={4}
        title="Add a Text action with the JSON body"
        body={
          <>
            <p className="mb-2">
              Add a <strong>Text</strong> action and paste the template below. Then tap each
              placeholder (the <code className="font-mono text-[11px]">__LIKE_THIS__</code> tokens)
              and replace it with the Magic Variable from the corresponding step 4 result.
              Tap-and-hold an existing variable to insert it.
            </p>
            <div className="relative">
              <pre className="text-[10px] font-mono bg-surface-100/40 p-3 rounded-lg overflow-x-auto whitespace-pre leading-snug">
                {jsonTemplate}
              </pre>
              <Button
                variant="outline"
                size="sm"
                className="absolute top-2 right-2 h-7 px-2 gap-1"
                onClick={() => copy(jsonTemplate, 'json')}
              >
                {copied === 'json' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                {copied === 'json' ? 'Copied' : 'Copy'}
              </Button>
            </div>
          </>
        }
      />

      {/* Step 5 — POST */}
      <Step
        number={5}
        title="Add a Get Contents of URL action"
        body={
          <>
            <p className="mb-2">
              Search for <strong>Get Contents of URL</strong>. Expand the details and set:
            </p>
            <ul className="list-disc pl-5 space-y-1 text-xs">
              <li>
                <strong>URL:</strong> paste the Ingest URL from the top of this panel
              </li>
              <li>
                <strong>Method:</strong> POST
              </li>
              <li>
                <strong>Headers:</strong> add two —{' '}
                <code className="font-mono text-[11px]">Content-Type</code> →{' '}
                <code className="font-mono text-[11px]">application/json</code>, and{' '}
                <code className="font-mono text-[11px]">{config.authHeader}</code> → paste the token
                from the top of this panel
              </li>
              <li>
                <strong>Request Body:</strong> set type to <strong>JSON</strong>, tap the body
                field, and insert the magic variable from your step 5 <em>Text</em> action
              </li>
            </ul>
          </>
        }
      />

      {/* Step 6 — schedule */}
      <Step
        number={6}
        title={`Schedule it for ${config.scheduleTime} daily`}
        body={
          <>
            <p className="mb-2">
              In Shortcuts, tap the <strong>Automation</strong> tab at the bottom, then{' '}
              <strong>+</strong> → <strong>Create Personal Automation</strong> →{' '}
              <strong>Time of Day</strong>.
            </p>
            <ul className="list-disc pl-5 space-y-1 text-xs">
              <li>
                Time: <strong>{config.scheduleTime}</strong> (uses your phone&apos;s current
                timezone, so 6 AM CST when you&apos;re in CST, 6 AM PT when you travel to PT)
              </li>
              <li>
                Repeat: <strong>Daily</strong>
              </li>
              <li>Next, tap your Sync Health → DocVault shortcut from the list</li>
              <li>
                Enable <strong>Run Immediately</strong> so it fires headless without a notification
                tap
              </li>
              <li>
                Disable <strong>Notify When Run</strong> if you don&apos;t want a banner every
                morning
              </li>
            </ul>
          </>
        }
      />

      {/* Step 7 — test */}
      <Step
        number={7}
        title="Test it once by hand"
        body={
          <>
            <p>
              Before waiting for 6 AM tomorrow, tap the <strong>▶</strong> button on your shortcut
              to run it now. If it succeeds, refresh DocVault and today&apos;s data should appear in
              the Activity / Heart / Sleep views. If it fails, check the token and URL in this panel
              — the most common mistake is an extra space or missing colon.
            </p>
          </>
        }
      />

      {/* Troubleshooting note */}
      <Card className="p-3 mt-4 border-accent-500/20 bg-accent-500/5">
        <div className="flex items-start gap-2 text-xs">
          <Info className="w-4 h-4 text-accent-400 flex-shrink-0 mt-0.5" />
          <div className="text-surface-700">
            <strong className="text-surface-950">
              Can&apos;t reach DocVault from outside your LAN?
            </strong>{' '}
            If your shortcut works at home but fails over cellular, you need either WireGuard
            On-Demand on your iPhone pointing at your NAS, or a separate reverse-proxy exposing
            DocVault to the internet with HTTPS + auth. The shortcut itself doesn&apos;t care; it
            just needs the URL above to resolve to your NAS from wherever your phone is.
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

function Step({ number, title, body }: { number: number; title: string; body: React.ReactNode }) {
  return (
    <div className="flex gap-3 mb-4">
      <div className="flex-shrink-0 w-7 h-7 rounded-full bg-accent-500/10 flex items-center justify-center">
        <span className="text-xs font-semibold text-accent-400">{number}</span>
      </div>
      <div className="flex-1 min-w-0 text-sm text-surface-700">
        <div className="font-medium text-surface-950 mb-1">{title}</div>
        <div className="leading-relaxed">{body}</div>
      </div>
    </div>
  );
}
