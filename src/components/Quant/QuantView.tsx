import { useState, useEffect } from 'react';
import {
  LineChart,
  Activity,
  Gauge,
  Layers,
  CalendarRange,
  TrendingDown,
  RefreshCw,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { PresidentialCycleChart } from './PresidentialCycleChart';
import { BtcLogRegressionChart } from './BtcLogRegressionChart';
import { useQuantRefresh } from './useQuantData';

type QuantTab =
  | 'overview'
  | 'btc-cycle'
  | 'risk-metric'
  | 'sector-rotation'
  | 'presidential-cycle'
  | 'midterm';

const STORAGE_KEY = 'docvault.quant.activeTab';

function Placeholder({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <Card variant="glass" className="p-8">
      <div className="flex flex-col gap-3">
        <h3 className="text-lg font-semibold text-surface-950">{title}</h3>
        <p className="text-[13px] text-surface-600 max-w-2xl leading-relaxed">{description}</p>
        {children}
        <div className="mt-6 h-48 rounded-xl border border-dashed border-border/60 bg-surface-100/40 flex items-center justify-center">
          <span className="text-[12px] text-surface-500 font-medium">
            Chart coming soon — data layer not wired yet
          </span>
        </div>
      </div>
    </Card>
  );
}

export function QuantView() {
  const [activeTab, setActiveTab] = useState<QuantTab>(() => {
    if (typeof window === 'undefined') return 'overview';
    const stored = localStorage.getItem(STORAGE_KEY);
    const valid: QuantTab[] = [
      'overview',
      'btc-cycle',
      'risk-metric',
      'sector-rotation',
      'presidential-cycle',
      'midterm',
    ];
    return valid.includes(stored as QuantTab) ? (stored as QuantTab) : 'overview';
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, activeTab);
  }, [activeTab]);

  const { refresh, refreshing, lastRefresh, error: refreshError } = useQuantRefresh();

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-6 py-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-surface-950 flex items-center gap-2">
            <LineChart className="w-6 h-6 text-cyan-400" />
            Quant
          </h2>
          <p className="text-[13px] text-surface-600 mt-1">
            Market cycle analysis, risk metrics, and sector rotation — inspired by Benjamin Cowen's
            Into The Cryptoverse style.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={refreshing}>
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'Refreshing...' : 'Refresh now'}
          </Button>
          {lastRefresh && (
            <span className="text-[10px] text-surface-500">
              Refreshed {new Date(lastRefresh).toLocaleTimeString()}
            </span>
          )}
          {refreshError && (
            <span className="text-[10px] text-danger-400 max-w-xs text-right">{refreshError}</span>
          )}
          {!lastRefresh && !refreshError && (
            <span className="text-[10px] text-surface-500">Auto-refreshes daily</span>
          )}
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as QuantTab)} className="gap-6">
        <TabsList>
          <TabsTrigger value="overview">
            <LineChart className="w-3.5 h-3.5" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="btc-cycle">
            <Activity className="w-3.5 h-3.5" />
            BTC Cycle
          </TabsTrigger>
          <TabsTrigger value="risk-metric">
            <Gauge className="w-3.5 h-3.5" />
            Risk Metric
          </TabsTrigger>
          <TabsTrigger value="sector-rotation">
            <Layers className="w-3.5 h-3.5" />
            Sector Rotation
          </TabsTrigger>
          <TabsTrigger value="presidential-cycle">
            <CalendarRange className="w-3.5 h-3.5" />
            Presidential Cycle
          </TabsTrigger>
          <TabsTrigger value="midterm">
            <TrendingDown className="w-3.5 h-3.5" />
            Midterm
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <Placeholder
            title="Overview"
            description="Top-level dashboard showing the current state of each signal: BTC position in the log regression bands, composite risk metric, leading/lagging sectors, and where we are in the presidential cycle. Everything you'd want on a single screen."
          />
        </TabsContent>

        <TabsContent value="btc-cycle">
          <BtcLogRegressionChart />
        </TabsContent>

        <TabsContent value="risk-metric">
          <Placeholder
            title="Composite Risk Metric (0–1)"
            description="Blended score from Mayer multiple, distance from 20W SMA, RSI, drawdown from ATH, and log-regression position. 0 = deep value, 1 = euphoric top. Use it as a systematic DCA / profit-taking signal rather than emotion."
          />
        </TabsContent>

        <TabsContent value="sector-rotation">
          <Placeholder
            title="Sector Rotation Dashboard"
            description="All 11 S&P sector ETFs (XLE, XLI, XLK, XLF, XLU, XLY, XLP, XLV, XLB, XLRE, XLC) ranked by relative strength vs. SPY and 20W SMA slope. Tells you what's leading right now — directly relevant to the energy/manufacturing thesis. Data source: Yahoo Finance."
          />
        </TabsContent>

        <TabsContent value="presidential-cycle">
          <PresidentialCycleChart />
        </TabsContent>

        <TabsContent value="midterm">
          <Placeholder
            title="Midterm Drawdown & Recovery Overlay"
            description="Every midterm year since 1950 plotted as a drawdown curve from the prior peak, with 2026 overlaid live. Answers the question: 'Are we tracking hot or cold compared to prior midterm cycles?' Ties into the sector-rotation view for timing energy/industrials entries."
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
