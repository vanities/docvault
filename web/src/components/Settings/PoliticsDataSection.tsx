import { CheckCircle, Landmark, LineChart, RefreshCw, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface PoliticsDataSectionProps {
  hasCongressKey: boolean;
  congressKeyHint?: string;
  newCongressKey: string;
  isSaving: boolean;
  politicsBackfilling: boolean;
  backtestRunning: boolean;
  politicsRefreshEnabled: boolean;
  politicsRefreshInterval: number;
  isScheduleSaving: boolean;
  scheduleSaved: boolean;
  onNewCongressKeyChange: (value: string) => void;
  onSaveCongressKey: () => void;
  onRemoveCongressKey: () => void;
  onBackfillPolitics: () => void;
  onRunBacktest: () => void;
  onPoliticsRefreshEnabledChange: (enabled: boolean) => void;
  onPoliticsRefreshIntervalChange: (minutes: number) => void;
  onSaveSchedules: () => void;
}

export function PoliticsDataSection({
  hasCongressKey,
  congressKeyHint,
  newCongressKey,
  isSaving,
  politicsBackfilling,
  backtestRunning,
  politicsRefreshEnabled,
  politicsRefreshInterval,
  isScheduleSaving,
  scheduleSaved,
  onNewCongressKeyChange,
  onSaveCongressKey,
  onRemoveCongressKey,
  onBackfillPolitics,
  onRunBacktest,
  onPoliticsRefreshEnabledChange,
  onPoliticsRefreshIntervalChange,
  onSaveSchedules,
}: PoliticsDataSectionProps) {
  return (
    <Card variant="glass" className="p-6 mb-8">
      <h3 className="text-lg font-semibold text-surface-950 mb-1 flex items-center gap-2">
        <Landmark className="w-5 h-5 text-violet-400" />
        Congressional &amp; Political Data
      </h3>
      <p className="text-[13px] text-surface-600 mb-5 leading-relaxed">
        Powers the Politics view: congressional stock trades (House/Senate PTRs), Trump&apos;s OGE
        filings, executive actions, recent bills, the copy-trade backtest, and consensus clusters.
        Most sources need no key — only the Congress.gov bills feed does.
      </p>

      <label className="block text-[13px] font-medium text-surface-800 mb-2">
        Congress.gov API Key
      </label>
      {hasCongressKey ? (
        <div className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
          <CheckCircle className="w-4 h-4 text-emerald-400" />
          <span className="text-[13px] text-emerald-400 font-medium flex-1">
            Key set
            {congressKeyHint && (
              <span className="text-emerald-400/70 ml-2 font-mono">****{congressKeyHint}</span>
            )}
          </span>
          <Button
            variant="ghost-danger"
            size="xs"
            onClick={onRemoveCongressKey}
            disabled={isSaving}
          >
            Remove
          </Button>
        </div>
      ) : (
        <div className="flex gap-2">
          <Input
            type="password"
            value={newCongressKey}
            onChange={(e) => onNewCongressKeyChange(e.target.value)}
            placeholder="Congress.gov API key..."
            className="flex-1 text-[13px] font-mono"
          />
          <Button onClick={onSaveCongressKey} disabled={isSaving || !newCongressKey}>
            <Save className="w-4 h-4" />
            Save
          </Button>
        </div>
      )}
      <p className="text-[11px] text-surface-500 mt-3">
        Free key at{' '}
        <a
          href="https://api.congress.gov/sign-up/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent-400 hover:underline"
        >
          api.congress.gov/sign-up
        </a>
        . House/Senate trades, Trump&apos;s OGE filings, and executive actions need no key.
      </p>

      <div className="mt-5 pt-4 border-t border-border/40">
        <p className="text-[13px] font-medium text-surface-800 mb-1">Populating the feed</p>
        <p className="text-[11px] text-surface-500 mb-3">
          The feed refreshes automatically on the schedule below, pulling only <em>new</em> filings
          (forward-only). To load the current year&apos;s full history in one pass, run a one-time{' '}
          <strong>backfill</strong> — it works server-side over a few minutes and the Politics view
          fills in as filings parse. <strong>Run backtest</strong> recomputes the copy-trade
          leaderboard from the disclosed trades.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={onBackfillPolitics} disabled={politicsBackfilling}>
            <RefreshCw className={`w-4 h-4 ${politicsBackfilling ? 'animate-spin' : ''}`} />
            {politicsBackfilling ? 'Starting…' : 'Run backfill'}
          </Button>
          <Button variant="secondary" onClick={onRunBacktest} disabled={backtestRunning}>
            <LineChart className={`w-4 h-4 ${backtestRunning ? 'animate-pulse' : ''}`} />
            {backtestRunning ? 'Starting…' : 'Run backtest'}
          </Button>
        </div>
      </div>

      <div className="mt-5 pt-4 border-t border-border/40">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-[13px] font-medium text-surface-900">Auto-refresh schedule</p>
            <p className="text-[11px] text-surface-500">
              How often to pull new bills, executive actions, and trades.
            </p>
          </div>
          <button
            onClick={() => onPoliticsRefreshEnabledChange(!politicsRefreshEnabled)}
            className={`relative w-10 h-5 rounded-full transition-colors ${politicsRefreshEnabled ? 'bg-violet-500' : 'bg-surface-400'}`}
          >
            <span
              className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform"
              style={{ left: politicsRefreshEnabled ? 22 : 2 }}
            />
          </button>
        </div>
        {politicsRefreshEnabled && (
          <div className="flex items-center gap-2">
            <label className="text-[12px] text-surface-600">Every</label>
            <Select
              value={String(politicsRefreshInterval)}
              onValueChange={(val) => onPoliticsRefreshIntervalChange(Number(val))}
            >
              <SelectTrigger className="text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="360">6 hours</SelectItem>
                <SelectItem value="720">12 hours</SelectItem>
                <SelectItem value="1440">24 hours</SelectItem>
                <SelectItem value="10080">7 days</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
        <Button
          onClick={onSaveSchedules}
          disabled={isScheduleSaving}
          className="bg-violet-500 hover:bg-violet-400 mt-3"
        >
          {scheduleSaved ? (
            <>
              <CheckCircle className="w-4 h-4" />
              Saved
            </>
          ) : (
            <>
              <Save className="w-4 h-4" />
              {isScheduleSaving ? 'Saving...' : 'Save schedule'}
            </>
          )}
        </Button>
      </div>
    </Card>
  );
}
