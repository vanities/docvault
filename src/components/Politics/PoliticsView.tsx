import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, RadioTower } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { ResearchPanel } from '../Quant/ResearchPanel';

type CheckTheVoteStatus =
  | { configured: false; ok: false; reason: 'missing_base_url' | 'missing_api_key' }
  | {
      configured: true;
      ok: boolean;
      baseUrl: string;
      checkedAt: string;
      service?: string;
      error?: string;
    };

function CheckTheVoteStatusCard() {
  const [status, setStatus] = useState<CheckTheVoteStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch('/api/check-the-vote/status')
      .then((res) => res.json())
      .then((data: CheckTheVoteStatus) => {
        if (!cancelled) setStatus(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setStatus({
            configured: true,
            ok: false,
            baseUrl: 'unknown',
            checkedAt: new Date().toISOString(),
            error: err instanceof Error ? err.message : String(err),
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const ok = status?.configured === true && status.ok;
  const Icon = loading ? Loader2 : ok ? CheckCircle2 : AlertCircle;
  const iconClass = loading
    ? 'text-surface-500 animate-spin'
    : ok
      ? 'text-emerald-400'
      : 'text-amber-400';

  return (
    <Card variant="glass" className="p-4 border-border/50">
      <div className="flex items-start gap-3">
        <div className="mt-0.5">
          <Icon className={`w-5 h-5 ${iconClass}`} />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <RadioTower className="w-3.5 h-3.5 text-surface-600" />
            <h2 className="text-sm font-semibold text-surface-950">Check the Vote connection</h2>
          </div>
          {loading ? (
            <p className="text-xs text-surface-600 mt-1">Checking Pi service status…</p>
          ) : !status?.configured ? (
            <p className="text-xs text-surface-700 mt-1">
              Not configured yet. Set <code>CHECKTHEVOTE_BASE_URL</code> and{' '}
              <code>CHECKTHEVOTE_API_KEY</code> once the Pi service is on the SSD.
            </p>
          ) : ok ? (
            <p className="text-xs text-surface-700 mt-1">
              Connected to <span className="font-mono">{status.baseUrl}</span>
              {status.service ? ` (${status.service})` : ''}.
            </p>
          ) : (
            <p className="text-xs text-amber-300 mt-1">
              Configured but unreachable: {status.error ?? 'unknown error'}
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

export function PoliticsView() {
  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-surface-600 font-semibold">
          Politics
        </p>
        <h1 className="font-display text-3xl text-surface-950 italic mt-1">
          Political intelligence
        </h1>
        <p className="text-sm text-surface-700 mt-2 max-w-3xl">
          Store political transcripts, PDFs, commentary notes, and source links separately from
          finance/health research. Check the Vote API status and trade/vote feeds can plug into this
          tab once the Pi service is live.
        </p>
      </div>

      <CheckTheVoteStatusCard />

      <ResearchPanel
        domain="politics"
        title="Political research inbox"
        description="Upload disclosure PDFs, paste commentator transcripts/articles, or fetch YouTube captions into a politics-only research partition."
        pdfHint="Political disclosure PDFs, policy reports, and raw source documents. Text is extracted automatically — no AI parsing."
      />
    </div>
  );
}
