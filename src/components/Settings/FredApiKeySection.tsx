import { CheckCircle, LineChart, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface FredApiKeySectionProps {
  hasFredKey: boolean;
  fredKeyHint?: string;
  newFredKey: string;
  isSaving: boolean;
  onNewFredKeyChange: (value: string) => void;
  onSaveFredKey: () => void;
  onRemoveFredKey: () => void;
}

export function FredApiKeySection({
  hasFredKey,
  fredKeyHint,
  newFredKey,
  isSaving,
  onNewFredKeyChange,
  onSaveFredKey,
  onRemoveFredKey,
}: FredApiKeySectionProps) {
  return (
    <Card variant="glass" className="p-6 mb-8">
      <h3 className="text-lg font-semibold text-surface-950 mb-1 flex items-center gap-2">
        <LineChart className="w-5 h-5 text-cyan-400" />
        FRED API Key
      </h3>
      <p className="text-[13px] text-surface-600 mb-4 leading-relaxed">
        Federal Reserve Economic Data (FRED) is the source for long-history macro series used by the
        Quant section: treasury yields, unemployment, CPI, M2, fed funds rate, DXY. The key is free
        and issued instantly.
      </p>

      <div className="mb-4 p-3 rounded-xl border border-border/40 bg-surface-100/40 text-[12px] text-surface-700 space-y-1.5">
        <div className="font-semibold text-surface-900">How to get one (30 seconds):</div>
        <ol className="list-decimal list-inside space-y-0.5">
          <li>
            Open{' '}
            <a
              href="https://fred.stlouisfed.org/docs/api/api_key.html"
              target="_blank"
              rel="noopener noreferrer"
              className="text-cyan-400 hover:underline"
            >
              fred.stlouisfed.org/docs/api/api_key.html
            </a>
          </li>
          <li>Click &ldquo;Request API Key&rdquo; and sign in (free account, ~20 seconds)</li>
          <li>
            App name: anything (e.g. <code className="text-cyan-400">docvault-quant</code>)
          </li>
          <li>
            App description:{' '}
            <em>
              &ldquo;Personal financial analysis dashboard for charting historical S&amp;P 500,
              treasury yields, and macro indicators.&rdquo;
            </em>
          </li>
          <li>Submit — your 32-char key is issued instantly. Paste it below.</li>
        </ol>
        <div className="text-surface-500 text-[11px] pt-1">
          Free tier: 120 requests/minute. Rate limits don&apos;t apply to our cached endpoints.
        </div>
      </div>

      <label className="block text-[13px] font-medium text-surface-800 mb-2">FRED API Key</label>
      {hasFredKey ? (
        <div className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
          <CheckCircle className="w-4 h-4 text-emerald-400" />
          <span className="text-[13px] text-emerald-400 font-medium flex-1">
            Key set
            {fredKeyHint && (
              <span className="text-emerald-400/70 ml-2 font-mono">****{fredKeyHint}</span>
            )}
          </span>
          <Button variant="ghost-danger" size="xs" onClick={onRemoveFredKey} disabled={isSaving}>
            Remove
          </Button>
        </div>
      ) : (
        <div className="flex gap-2">
          <Input
            type="password"
            value={newFredKey}
            onChange={(e) => onNewFredKeyChange(e.target.value)}
            placeholder="FRED API key (32 hex chars)..."
            className="flex-1 text-[13px] font-mono"
          />
          <Button onClick={onSaveFredKey} disabled={isSaving || !newFredKey}>
            <Save className="w-4 h-4" />
            Save
          </Button>
        </div>
      )}

      <p className="text-[11px] text-surface-500 mt-3">
        S&amp;P 500 price data itself comes from the{' '}
        <a
          href="https://github.com/datasets/s-and-p-500"
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent-400 hover:underline"
        >
          Shiller dataset on GitHub
        </a>{' '}
        (monthly back to 1871, no key needed). FRED powers the macro overlays.
      </p>
    </Card>
  );
}
