import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  FileWarning,
  Landmark,
  Link2,
  Loader2,
  RadioTower,
  RefreshCw,
  Scale,
  TrendingUp,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { ResearchPanel } from '../Quant/ResearchPanel';
import { TradeExplorer } from './TradeExplorer';
import { ConsensusPanel } from './ConsensusPanel';
import { BrowseOverlay, type BrowseCategory } from './BrowseOverlay';
import { DashboardFeeds } from './DashboardFeeds';
import { summarizePoliticsData, type PoliticsFeedPayload } from './politicsData';

interface ResearchPoliticsLink {
  entryId: string;
  title?: string;
  claimId: string;
  claimText: string;
  sourceUrl?: string;
  tickers: string[];
  topics: string[];
  stance?: string;
  matchedTrades: Array<{ politicianName?: string; ticker: string; category?: string }>;
  matchedVotes: Array<{ externalId?: string; label: string }>;
}

interface ResearchPoliticsBrief {
  key: string;
  kind: 'ticker' | 'topic';
  label: string;
  claimCount: number;
  tradeMatchCount: number;
  voteMatchCount: number;
  stances: string[];
  sourceUrls: string[];
  sampleClaims: Array<{ entryId: string; claimId: string; text: string; title?: string }>;
  matchedTrades: Array<{ politicianName?: string; ticker: string; category?: string }>;
  matchedVotes: Array<{ externalId?: string; label: string }>;
}

function CongressDashboard() {
  const [browse, setBrowse] = useState<BrowseCategory | null>(null);
  const [payload, setPayload] = useState<PoliticsFeedPayload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch('/api/politics/feed')
      .then((res) => res.json())
      .then((data: PoliticsFeedPayload) => {
        if (!cancelled) setPayload(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setPayload({
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

  const summary = useMemo(() => (payload ? summarizePoliticsData(payload) : null), [payload]);
  const ok = summary?.configured === true && summary.ok;
  const Icon = loading ? Loader2 : ok ? CheckCircle2 : AlertCircle;
  const iconClass = loading
    ? 'text-surface-500 animate-spin'
    : ok
      ? 'text-emerald-400'
      : 'text-amber-400';

  return (
    <section className="space-y-4" aria-label="Congress feed dashboard">
      <Card variant="glass" className="p-4 border-border/50">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex items-start gap-3">
            <div className="mt-0.5">
              <Icon className={`w-5 h-5 ${iconClass}`} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <RadioTower className="w-3.5 h-3.5 text-surface-600" />
                <h2 className="text-sm font-semibold text-surface-950">Congress feed</h2>
              </div>
              {loading ? (
                <p className="text-xs text-surface-600 mt-1">Loading politics feed…</p>
              ) : ok ? (
                <p className="text-xs text-surface-700 mt-1">
                  Bills, executive actions, and politician trades — ingested in-house, refreshed
                  daily.
                </p>
              ) : (
                <p className="text-xs text-amber-300 mt-1">
                  {summary?.errorLabel ?? 'No data yet — the daily politics refresh hasn’t run.'}
                </p>
              )}
            </div>
          </div>
          {summary?.checkedAt && (
            <div className="text-xs text-surface-600 flex items-center gap-1">
              <RefreshCw className="w-3.5 h-3.5" />
              Checked {new Date(summary.checkedAt).toLocaleString()}
            </div>
          )}
        </div>
      </Card>

      <div className="grid gap-3 md:grid-cols-4">
        <MetricCard
          icon={Landmark}
          label="Bills"
          value={summary?.recentVoteCount ?? 0}
          onClick={() => setBrowse('bills')}
        />
        <MetricCard
          icon={Scale}
          label="Executive actions"
          value={summary?.recentExecutiveActionCount ?? 0}
          onClick={() => setBrowse('executiveActions')}
        />
        <MetricCard
          icon={TrendingUp}
          label="Trades"
          value={summary?.recentTradeCount ?? 0}
          onClick={() => setBrowse('trades')}
        />
        <MetricCard
          icon={FileWarning}
          label="Filings"
          value={summary?.filingsNeedingAttentionCount ?? 0}
          tone={(summary?.filingsNeedingAttentionCount ?? 0) > 0 ? 'warn' : 'ok'}
          onClick={() => setBrowse('filings')}
        />
      </div>

      <DashboardFeeds payload={payload} />

      {browse && (
        <BrowseOverlay category={browse} payload={payload} onClose={() => setBrowse(null)} />
      )}
    </section>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  tone = 'neutral',
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  tone?: 'neutral' | 'ok' | 'warn';
  onClick?: () => void;
}) {
  const toneClass =
    tone === 'warn' ? 'text-amber-300' : tone === 'ok' ? 'text-emerald-400' : 'text-surface-950';
  return (
    <Card
      variant="glass"
      onClick={onClick}
      className={`p-4 border-border/50 ${onClick ? 'cursor-pointer hover:border-accent-500/60 transition-colors' : ''}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-surface-600 flex items-center gap-1">
            {label}
            {onClick && <span className="text-surface-700">→</span>}
          </p>
          <p className={`text-2xl font-semibold mt-1 ${toneClass}`}>{value.toLocaleString()}</p>
        </div>
        <Icon className="w-5 h-5 text-surface-600" />
      </div>
    </Card>
  );
}

function ResearchPoliticsLinksCard() {
  const [links, setLinks] = useState<ResearchPoliticsLink[]>([]);
  const [briefs, setBriefs] = useState<ResearchPoliticsBrief[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch('/api/research/politics-links')
      .then(
        (res) =>
          res.json() as Promise<{
            links?: ResearchPoliticsLink[];
            briefs?: ResearchPoliticsBrief[];
          }>
      )
      .then((data) => {
        if (!cancelled) {
          setLinks(data.links ?? []);
          setBriefs(data.briefs ?? []);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLinks([]);
          setBriefs([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Card variant="glass" className="p-4 border-border/50">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <Link2 className="w-4 h-4 text-surface-600" />
          <h3 className="text-sm font-semibold text-surface-950">Asset/topic intelligence radar</h3>
        </div>
        {loading && <Loader2 className="w-3.5 h-3.5 text-surface-600 animate-spin" />}
      </div>
      {briefs.length > 0 && (
        <div className="mb-4 grid gap-3 md:grid-cols-2">
          {briefs.slice(0, 4).map((brief) => (
            <div
              key={brief.key}
              className="rounded-lg border border-border/50 bg-surface-100/50 p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold text-surface-950">{brief.label}</p>
                  <p className="text-[11px] uppercase tracking-wide text-surface-500">
                    {brief.kind === 'ticker' ? 'Asset' : 'Topic'} signal
                  </p>
                </div>
                <div className="text-right text-[11px] text-surface-600">
                  <div>
                    {brief.claimCount} claim{brief.claimCount === 1 ? '' : 's'}
                  </div>
                  <div>
                    {brief.tradeMatchCount} trade · {brief.voteMatchCount} vote
                  </div>
                </div>
              </div>
              {brief.stances.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {brief.stances.map((stance) => (
                    <span
                      key={stance}
                      className="rounded-full bg-surface-200 px-2 py-0.5 text-[10px] uppercase text-surface-600"
                    >
                      {stance}
                    </span>
                  ))}
                </div>
              )}
              {brief.sampleClaims[0] && (
                <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-surface-700">
                  {brief.sampleClaims[0].text}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
      {links.length === 0 ? (
        <p className="text-xs text-surface-600">
          No linked research claims yet. Extract intelligence on a politics research entry to match
          tickers/topics against politician trades and bills.
        </p>
      ) : (
        <div className="space-y-3">
          {links.slice(0, 5).map((link) => (
            <div key={`${link.entryId}-${link.claimId}`} className="border-l border-border/60 pl-3">
              <div className="flex flex-wrap items-center gap-1.5 mb-1">
                {link.tickers.map((ticker) => (
                  <span key={ticker} className="text-[10px] font-mono text-accent-400">
                    {ticker}
                  </span>
                ))}
                {link.topics.map((topic) => (
                  <span key={topic} className="text-[10px] text-surface-600">
                    #{topic}
                  </span>
                ))}
                {link.stance && (
                  <span className="text-[10px] uppercase text-surface-500">{link.stance}</span>
                )}
              </div>
              <p className="text-xs text-surface-800 leading-relaxed">{link.claimText}</p>
              <p className="text-[11px] text-surface-600 mt-1">
                {link.title ?? 'Research entry'} · {link.matchedTrades.length} trade match
                {link.matchedTrades.length === 1 ? '' : 'es'} · {link.matchedVotes.length} vote/bill
                match{link.matchedVotes.length === 1 ? '' : 'es'}
                {link.sourceUrl && (
                  <>
                    {' · '}
                    <a
                      href={link.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent-400 hover:underline"
                    >
                      source
                    </a>
                  </>
                )}
              </p>
            </div>
          ))}
        </div>
      )}
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
          Recent congressional bills, presidential executive actions, and politician stock trades
          (House PTRs + Trump&apos;s OGE disclosures) — ingested in-house and refreshed daily —
          alongside your local commentary and source notes.
        </p>
      </div>

      <CongressDashboard />

      <ConsensusPanel />

      <TradeExplorer />

      <ResearchPoliticsLinksCard />

      <ResearchPanel
        domain="politics"
        title="Political research inbox"
        description="Upload disclosure PDFs, paste commentator transcripts/articles, or fetch YouTube captions into a politics-only research partition."
        pdfHint="Political disclosure PDFs, policy reports, and raw source documents. Text is extracted automatically — no AI parsing."
      />
    </div>
  );
}
