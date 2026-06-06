// Per-person setup card for the DocVault Sync iOS app (workouts).
//
// Companion to ShortcutSetupGuide: the Shortcut handles daily *metrics*, but
// iOS Shortcuts cannot read workout *sessions* — Apple exposes workouts only to
// write/control intents, never to query (verified against the Shortcuts action
// catalog). The DocVault Sync app holds the HealthKit entitlement, reads
// workouts, and POSTs them to /api/health/:personId/workouts. To configure it
// without typing a long token on a phone keyboard, we render the app's
// `docvaultsync://configure?…` deep link as a QR code — scan it with the iPhone
// Camera and the app opens pre-filled with this DocVault's origin + token.

import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Dumbbell, Copy, Check } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { API_BASE } from '../../constants';

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
        <Dumbbell className="w-5 h-5 text-accent-400" />
        <h3 className="font-medium text-surface-950">Workout sync app</h3>
      </div>
      <p className="text-sm text-surface-700 mb-4 leading-relaxed">
        Apple Shortcuts can&apos;t read workout <em>sessions</em> — only the bulk export and the
        DocVault Sync app can. Install the app on {personName}&apos;s iPhone, then scan this code
        with the Camera to configure it (no typing your token). It reads workouts and posts them
        straight here, so your sessions stay current without re-exporting.
      </p>
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
