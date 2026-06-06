import { ExternalLink, FileWarning, Landmark, Scale, TrendingUp } from 'lucide-react';
import { Card } from '@/components/ui/card';
import type { PoliticsFeedPayload } from './politicsData';

// --- item shapes (parsed defensively from the loose feed payload) -----------

interface BillItem {
  externalId: string;
  officialId: string;
  title: string;
  status: string;
  url: string | null;
}
interface TradeItem {
  politicianName: string;
  ticker: string | null;
  assetName: string;
  category: string;
  transactionDescription: string;
  amount: string | null;
  tradeDate: string;
}
interface ExecItem {
  slug: string;
  type: string;
  title: string;
  issuedDate: string;
  url: string | null;
}
interface FilingItem {
  externalId: string;
  filerName: string;
  chamber: string;
  warning: string;
  sourceUrl: string | null;
}

function arr<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/** Yahoo Finance quote page for a disclosed ticker. */
function tickerUrl(ticker: string): string {
  return `https://finance.yahoo.com/quote/${encodeURIComponent(ticker.replace(/\./g, '-'))}`;
}

const CHAMBER_LABEL: Record<string, string> = {
  house: 'House',
  senate: 'Senate',
  executive: 'Executive',
};

const BILL_STATUS: Record<string, { label: string; cls: string }> = {
  signed: { label: 'Signed', cls: 'bg-emerald-500/15 text-emerald-300' },
  vetoed: { label: 'Vetoed', cls: 'bg-rose-500/15 text-rose-300' },
  passed_both: { label: 'Passed both', cls: 'bg-sky-500/15 text-sky-300' },
  passed_chamber: { label: 'Passed', cls: 'bg-sky-500/15 text-sky-300' },
  committee: { label: 'Committee', cls: 'bg-amber-500/15 text-amber-300' },
  introduced: { label: 'Introduced', cls: 'bg-surface-200/60 text-surface-500' },
};

const EXEC_TYPE: Record<string, string> = {
  executive_order: 'Executive Order',
  proclamation: 'Proclamation',
  signing_statement: 'Memo',
};

function Pill({ children, cls }: { children: React.ReactNode; cls: string }) {
  return (
    <span className={`rounded px-1.5 py-px text-[10px] font-medium whitespace-nowrap ${cls}`}>
      {children}
    </span>
  );
}

function tradeCls(category: string): string {
  if (category === 'buy') return 'bg-emerald-500/15 text-emerald-300';
  if (category === 'sell') return 'bg-rose-500/15 text-rose-300';
  if (category === 'exchange') return 'bg-sky-500/15 text-sky-300';
  return 'bg-surface-200/60 text-surface-500';
}

function Panel({
  icon: Icon,
  title,
  badge,
  empty,
  count,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  badge?: string;
  empty: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <Card variant="glass" className="p-4 border-border/50 min-h-48">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-surface-600" />
          <h3 className="text-sm font-semibold text-surface-950">{title}</h3>
        </div>
        {badge && <span className="text-xs text-surface-600 font-mono">{badge}</span>}
      </div>
      {count === 0 ? (
        <p className="text-xs text-surface-600">{empty}</p>
      ) : (
        <ul className="max-h-72 overflow-y-auto -mr-1 pr-1">{children}</ul>
      )}
    </Card>
  );
}

/** A row that links out (bills, exec actions, filings) with a hover affordance. */
function LinkRow({ href, children }: { href: string | null; children: React.ReactNode }) {
  const inner = (
    <div className="group flex items-start gap-2 py-1.5 -mx-1 px-1 rounded hover:bg-surface-100/50">
      <div className="min-w-0 flex-1">{children}</div>
      {href && (
        <ExternalLink className="w-3 h-3 text-surface-500 opacity-0 group-hover:opacity-100 shrink-0 mt-0.5" />
      )}
    </div>
  );
  return (
    <li className="border-b border-border/20 last:border-0">
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer">
          {inner}
        </a>
      ) : (
        inner
      )}
    </li>
  );
}

export function DashboardFeeds({ payload }: { payload: PoliticsFeedPayload | null }) {
  const bills = arr<BillItem>(payload?.bills);
  const trades = arr<TradeItem>((payload?.trades as { trades?: unknown } | undefined)?.trades);
  const execActions = arr<ExecItem>(payload?.executiveActions);
  const filings = arr<FilingItem>((payload?.filings as { filings?: unknown } | undefined)?.filings);

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <Panel
        icon={Landmark}
        title="Recent bills"
        count={bills.length}
        empty="No recent bills yet. Add a Congress.gov key in Settings."
      >
        {bills.slice(0, 8).map((b) => (
          <LinkRow key={b.externalId} href={b.url}>
            <span className="block text-xs text-surface-800 leading-snug line-clamp-2 group-hover:text-accent-300">
              {b.title}
            </span>
            <div className="flex items-center gap-1.5 mt-1">
              <span className="font-mono text-[10px] text-surface-500">{b.officialId}</span>
              <Pill cls={(BILL_STATUS[b.status] ?? BILL_STATUS.introduced).cls}>
                {(BILL_STATUS[b.status] ?? BILL_STATUS.introduced).label}
              </Pill>
            </div>
          </LinkRow>
        ))}
      </Panel>

      <Panel
        icon={Scale}
        title="Executive actions"
        count={execActions.length}
        empty="No recent executive actions yet."
      >
        {execActions.slice(0, 8).map((a) => (
          <LinkRow key={a.slug} href={a.url}>
            <span className="block text-xs text-surface-800 leading-snug line-clamp-2 group-hover:text-accent-300">
              {a.title}
            </span>
            <div className="flex items-center gap-1.5 mt-1">
              <Pill cls="bg-violet-500/15 text-violet-300">{EXEC_TYPE[a.type] ?? a.type}</Pill>
              <span className="text-[10px] text-surface-500">{a.issuedDate}</span>
            </div>
          </LinkRow>
        ))}
      </Panel>

      <Panel
        icon={TrendingUp}
        title="Recent trades"
        count={trades.length}
        empty="No recent politician trades yet."
      >
        {trades.slice(0, 10).map((t, i) => (
          <li
            key={`${t.politicianName}-${t.ticker}-${t.tradeDate}-${i}`}
            className="py-1.5 border-b border-border/20 last:border-0"
          >
            <div className="flex items-center gap-2">
              <Pill cls={tradeCls(t.category)}>{t.transactionDescription || t.category}</Pill>
              {t.ticker ? (
                <a
                  href={tickerUrl(t.ticker)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-xs text-accent-400 hover:underline shrink-0"
                  title={`Open ${t.ticker} on Yahoo Finance`}
                >
                  {t.ticker}
                </a>
              ) : (
                <span className="text-[11px] italic text-surface-500 shrink-0">bond/other</span>
              )}
              <span className="text-surface-700 tabular-nums text-[11px] ml-auto shrink-0">
                {t.amount}
              </span>
            </div>
            <div className="text-[10px] text-surface-500 mt-0.5 truncate">
              {t.politicianName} · <span className="text-surface-600">{t.assetName}</span> ·{' '}
              {t.tradeDate}
            </div>
          </li>
        ))}
      </Panel>

      <Panel
        icon={FileWarning}
        title="Filings needing attention"
        count={filings.length}
        badge={filings.length ? String(filings.length) : undefined}
        empty="No filing warnings in the recent feed."
      >
        {filings.slice(0, 10).map((f) => (
          <LinkRow key={f.externalId} href={f.sourceUrl}>
            <span className="block text-xs text-surface-800 truncate group-hover:text-accent-300">
              {f.filerName}
            </span>
            <div className="flex items-center gap-1.5 mt-0.5 text-[10px]">
              <span className="text-surface-500">{CHAMBER_LABEL[f.chamber] ?? f.chamber}</span>
              <span className="text-amber-300/80 truncate">{f.warning}</span>
            </div>
          </LinkRow>
        ))}
      </Panel>
    </div>
  );
}
