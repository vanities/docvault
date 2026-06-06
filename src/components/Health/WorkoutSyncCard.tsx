// Per-person setup card for the DocVault Sync iOS app.
//
// The app holds the HealthKit entitlement that iOS Shortcuts lack: it reads
// workout *sessions*, daily quantity metrics, sleep, and clinical (FHIR)
// records, and POSTs them to /api/health/:personId/{workouts,sync,clinical}.
// It also registers HealthKit background delivery, so once installed it keeps
// syncing on its own when new data lands — no manual re-export.
//
// Setup is two steps: (1) install from TestFlight, (2) scan the QR below with
// the iPhone Camera. The QR encodes the app's `docvaultsync://configure?…`
// deep link, so the app opens pre-filled with this DocVault's origin + token —
// no typing a long token on a phone keyboard.

import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { HeartPulse, Copy, Check, ExternalLink } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { API_BASE } from '../../constants';

// Public TestFlight link for the DocVault Sync companion app. Not personal data
// — it's the canonical beta build any DocVault user installs on their iPhone.
const TESTFLIGHT_URL = 'https://testflight.apple.com/join/86bksgtW';

interface AppConfig {
  personId: string;
  appDeepLink: string;
}

interface WorkoutSyncCardProps {
  personId: string;
  personName: string;
}

export function WorkoutSyncCard({ personId, personName }: WorkoutSyncCardProps) {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/health/${personId}/shortcut-config`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((c: AppConfig) => {
        if (!cancelled) setConfig(c);
      })
      .catch(() => {
        /* config unavailable — the card simply doesn't render */
      });
    return () => {
      cancelled = true;
    };
  }, [personId]);

  if (!config?.appDeepLink) return null;

  const copy = () => {
    // navigator.clipboard needs HTTPS; fall back to execCommand on HTTP (Unraid).
    try {
      void navigator.clipboard.writeText(config.appDeepLink);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = config.appDeepLink;
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 mb-4">
        <HeartPulse className="w-5 h-5 text-accent-400" />
        <h3 className="font-medium text-surface-950">DocVault Sync app</h3>
      </div>
      <p className="text-sm text-surface-700 mb-4 leading-relaxed">
        The companion iOS app reads what Apple Shortcuts can&apos;t — workout sessions, plus daily
        metrics, sleep, and clinical records — and keeps {personName}&apos;s data current in the
        background, no re-exporting. Two steps:
      </p>
      <ol className="mb-4 ml-1 space-y-3 text-sm text-surface-700">
        <li className="flex items-start gap-3">
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-500/15 text-xs font-semibold text-accent-300">
            1
          </span>
          <span>
            Install from TestFlight on {personName}&apos;s iPhone:
            <a
              href={TESTFLIGHT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-2 inline-flex items-center gap-1 font-medium text-accent-400 hover:underline"
            >
              Get the app <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </span>
        </li>
        <li className="flex items-start gap-3">
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-500/15 text-xs font-semibold text-accent-300">
            2
          </span>
          <span>Open the iPhone Camera and scan the code below to configure it.</span>
        </li>
      </ol>
      <div className="flex flex-col items-center gap-5 sm:flex-row">
        <div className="shrink-0 rounded-lg bg-white p-3">
          <QRCodeSVG value={config.appDeepLink} size={160} level="M" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="mb-2 text-xs text-surface-600">
            Scan with the iPhone Camera, or copy the configuration link:
          </p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-surface-100 px-2 py-1 text-xs">
              {config.appDeepLink}
            </code>
            <Button variant="ghost" size="sm" onClick={copy} className="shrink-0">
              {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
