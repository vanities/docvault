// Full-screen drill-down browser for the Politics section. Clicking a "Recent X"
// metric on the dashboard opens this over the page: search + filter + see-all for
// trades, bills, executive actions, or archived filings. Closeable back to the
// dashboard (ESC or the X).

import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, FileText, Loader2, Search } from 'lucide-react';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export type BrowseCategory = 'trades' | 'bills' | 'executiveActions' | 'filings';

interface OptionDetail {
  optionType: 'call' | 'put';
  action: string | null;
  contracts: number | null;
  strike: number | null;
  expiry: string | null;
}
interface Trade {
  politicianName: string;
  chamber: string;
  ticker: string | null;
  assetName: string;
  category: string;
  transactionDescription: string;
  tradeDate: string;
  amount: string | null;
  sourceUrl: string | null;
  option?: OptionDetail | null;
}
interface Bill {
  officialId: string;
  title: string;
  status: string;
  latestActionDate: string | null;
  url: string | null;
}
interface ExecAction {
  type: string;
  title: string;
  issuedDate: string;
  url: string | null;
}
interface FilingMeta {
  docId: string;
  source: string;
  chamber: string;
  filerName: string;
  filingYear: number;
  filingDate: string | null;
  filingUrl: string;
  parseMethod: string;
  tradeCount: number;
  hasPdf: boolean;
}

const CATEGORY_LABEL: Record<BrowseCategory, string> = {
  trades: 'All trades',
  bills: 'All bills',
  executiveActions: 'All executive actions',
  filings: 'Filing archive',
};

function tickerUrl(ticker: string): string {
  return `https://finance.yahoo.com/quote/${encodeURIComponent(ticker.replace(/\./g, '-'))}`;
}
function categoryClass(c: string): string {
  if (c === 'buy') return 'text-emerald-400';
  if (c === 'sell') return 'text-rose-400';
  if (c === 'exchange') return 'text-sky-400';
  return 'text-surface-500';
}
function optionLabel(o: OptionDetail): string {
  const parts: string[] = [];
  if (o.strike != null) parts.push(`$${o.strike}`);
  parts.push(o.optionType === 'call' ? 'CALL' : 'PUT');
  if (o.expiry) {
    const [y, m, d] = o.expiry.split('-');
    parts.push(`exp ${Number(m)}/${Number(d)}/${y.slice(2)}`);
  }
  if (o.contracts != null) parts.push(`${o.contracts}×`);
  return parts.join(' · ');
}
function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}
function statusBadge(status: string): string {
  if (status === 'signed' || status === 'passed_both') return 'bg-emerald-500/15 text-emerald-300';
  if (status === 'vetoed') return 'bg-rose-500/15 text-rose-300';
  if (status.startsWith('passed')) return 'bg-sky-500/15 text-sky-300';
  return 'bg-surface-200/60 text-surface-800';
}

export function BrowseOverlay({
  category,
  payload,
  onClose,
}: {
  category: BrowseCategory;
  payload: { bills?: unknown; executiveActions?: unknown } | null;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [compact, setCompact] = useState(() => window.matchMedia('(width < 40rem)').matches);

  useEffect(() => {
    const media = window.matchMedia('(width < 40rem)');
    const update = () => setCompact(media.matches);
    media.addEventListener('change', update);
    update();
    return () => media.removeEventListener('change', update);
  }, []);
  const [trades, setTrades] = useState<Trade[] | null>(null);
  const [filings, setFilings] = useState<FilingMeta[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [chamber, setChamber] = useState('all');
  const [direction, setDirection] = useState('all');
  const [optionsOnly, setOptionsOnly] = useState(false);

  // Fetch the heavy categories once on open.
  useEffect(() => {
    let alive = true;
    if (category === 'trades') {
      setLoading(true);
      fetch('/api/politics/trades?limit=2000')
        .then((r) => r.json())
        .then((d) => alive && setTrades(d.trades ?? []))
        .catch(() => alive && setTrades([]))
        .finally(() => alive && setLoading(false));
    } else if (category === 'filings') {
      setLoading(true);
      fetch('/api/politics/filings?limit=5000')
        .then((r) => r.json())
        .then((d) => alive && setFilings(d.filings ?? []))
        .catch(() => alive && setFilings([]))
        .finally(() => alive && setLoading(false));
    }
    return () => {
      alive = false;
    };
  }, [category]);

  const q = query.trim().toLowerCase();

  const visibleTrades = useMemo(() => {
    let out = trades ?? [];
    if (chamber !== 'all') out = out.filter((t) => t.chamber === chamber);
    if (direction !== 'all') out = out.filter((t) => t.category === direction);
    if (optionsOnly) out = out.filter((t) => t.option);
    if (q)
      out = out.filter(
        (t) =>
          (t.ticker ?? '').toLowerCase().includes(q) ||
          t.politicianName.toLowerCase().includes(q) ||
          t.assetName.toLowerCase().includes(q)
      );
    return out;
  }, [trades, chamber, direction, optionsOnly, q]);

  const visibleFilings = useMemo(() => {
    let out = filings ?? [];
    if (chamber !== 'all') out = out.filter((f) => f.chamber === chamber);
    if (q) out = out.filter((f) => f.filerName.toLowerCase().includes(q) || f.docId.includes(q));
    return out;
  }, [filings, chamber, q]);

  const visibleBills = useMemo(() => {
    const all = asArray<Bill>(payload?.bills);
    return q
      ? all.filter(
          (b) => b.title.toLowerCase().includes(q) || b.officialId.toLowerCase().includes(q)
        )
      : all;
  }, [payload, q]);

  const visibleExec = useMemo(() => {
    const all = asArray<ExecAction>(payload?.executiveActions);
    return q ? all.filter((e) => e.title.toLowerCase().includes(q)) : all;
  }, [payload, q]);

  const count =
    category === 'trades'
      ? visibleTrades.length
      : category === 'filings'
        ? visibleFilings.length
        : category === 'bills'
          ? visibleBills.length
          : visibleExec.length;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent fullscreen className="bg-surface-0" aria-describedby={undefined}>
        <DialogHeader className="px-4 md:px-6 py-3 pr-14 border-b border-border/60">
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle className="font-display text-xl text-surface-950">
              {CATEGORY_LABEL[category]}
            </DialogTitle>
            <span className="text-sm text-surface-500 tabular-nums">{count.toLocaleString()}</span>
          </div>
        </DialogHeader>

        <DialogBody className="m-0 p-0">
          <div className="px-4 md:px-6 py-3 border-b border-border/40 flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-auto sm:flex-1 min-w-0">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-500" />
              <input
                aria-label="Search entries"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={
                  category === 'trades'
                    ? 'Search ticker, politician, asset…'
                    : category === 'filings'
                      ? 'Search filer or doc id…'
                      : 'Search…'
                }
                className="w-full min-h-11 bg-surface-100 border border-border/60 rounded-md pl-8 pr-3 py-1.5 text-base sm:text-sm text-surface-950 placeholder:text-surface-600"
              />
            </div>
            {(category === 'trades' || category === 'filings') && (
              <select
                value={chamber}
                aria-label="Chamber"
                onChange={(e) => setChamber(e.target.value)}
                className="min-h-11 max-w-full text-base sm:text-sm bg-surface-100 border border-border/60 rounded-md px-2 py-1.5 text-surface-800"
              >
                <option value="all">All chambers</option>
                <option value="house">House</option>
                <option value="senate">Senate</option>
                <option value="executive">Executive</option>
              </select>
            )}
            {category === 'trades' && (
              <>
                <select
                  value={direction}
                  aria-label="Trade direction"
                  onChange={(e) => setDirection(e.target.value)}
                  className="min-h-11 max-w-full text-base sm:text-sm bg-surface-100 border border-border/60 rounded-md px-2 py-1.5 text-surface-800"
                >
                  <option value="all">Buys & sells</option>
                  <option value="buy">Buys</option>
                  <option value="sell">Sells</option>
                </select>
                <label className="flex min-h-11 items-center gap-1.5 text-sm text-surface-800 px-2">
                  <input
                    type="checkbox"
                    checked={optionsOnly}
                    onChange={(e) => setOptionsOnly(e.target.checked)}
                  />
                  Options only
                </label>
              </>
            )}
          </div>

          <div className="px-4 md:px-6 py-4 overflow-x-auto">
            {loading ? (
              <div className="flex items-center justify-center py-20 text-surface-500">
                <Loader2 className="w-6 h-6 animate-spin" />
              </div>
            ) : count === 0 ? (
              <p className="text-center text-surface-600 py-20">Nothing matches.</p>
            ) : category === 'trades' ? (
              <TradesTable trades={visibleTrades} compact={compact} />
            ) : category === 'filings' ? (
              <FilingsTable filings={visibleFilings} compact={compact} />
            ) : category === 'bills' ? (
              <BillsList bills={visibleBills} />
            ) : (
              <ExecList actions={visibleExec} />
            )}
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

function TradesTable({ trades, compact }: { trades: Trade[]; compact: boolean }) {
  if (compact)
    return (
      <div className="space-y-3">
        {trades.slice(0, 1000).map((trade, index) => (
          <article
            key={index}
            className="rounded-xl border border-border/60 bg-surface-100/50 p-3 space-y-2"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-medium text-surface-950 break-words">{trade.politicianName}</h3>
              <time className="text-xs text-surface-600 tabular-nums">{trade.tradeDate}</time>
            </div>
            <p className={`text-sm font-medium ${categoryClass(trade.category)}`}>
              {trade.transactionDescription || trade.category}
            </p>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {trade.ticker ? (
                <a
                  href={tickerUrl(trade.ticker)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-11 items-center font-mono text-accent-400 underline underline-offset-4"
                >
                  {trade.ticker}
                </a>
              ) : null}
              <span className="text-surface-800 break-words">{trade.assetName}</span>
            </div>
            {trade.option && (
              <p className="text-xs font-mono text-surface-800 break-words">
                {optionLabel(trade.option)}
              </p>
            )}
            {trade.amount && (
              <p className="text-sm text-surface-700">
                <span className="text-surface-600">Amount: </span>
                {trade.amount}
              </p>
            )}
            {trade.sourceUrl && (
              <a
                href={trade.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-11 items-center gap-1 text-sm text-accent-400"
              >
                <ExternalLink className="size-4" /> Source
              </a>
            )}
          </article>
        ))}
      </div>
    );
  return (
    <table className="w-full text-sm border-collapse">
      <thead className="text-xs uppercase tracking-wide text-surface-500 text-left sticky top-0 bg-surface-0">
        <tr>
          <th className="px-2 py-1.5 font-medium">Date</th>
          <th className="px-2 py-1.5 font-medium">Politician</th>
          <th className="px-2 py-1.5 font-medium">Type</th>
          <th className="px-2 py-1.5 font-medium">Ticker / contract</th>
          <th className="px-2 py-1.5 font-medium text-right">Amount</th>
        </tr>
      </thead>
      <tbody>
        {trades.slice(0, 1000).map((t, i) => (
          <tr key={i} className="border-t border-border/20 hover:bg-surface-100/50">
            <td className="px-2 py-1.5 text-surface-500 tabular-nums whitespace-nowrap">
              {t.tradeDate}
            </td>
            <td className="px-2 py-1.5 text-surface-800">{t.politicianName}</td>
            <td className={`px-2 py-1.5 font-medium ${categoryClass(t.category)}`}>
              {t.transactionDescription || t.category}
            </td>
            <td className="px-2 py-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                {t.ticker ? (
                  <a
                    href={tickerUrl(t.ticker)}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-accent-400 hover:underline"
                  >
                    {t.ticker}
                  </a>
                ) : (
                  <span className="text-surface-500 truncate max-w-[16rem]" title={t.assetName}>
                    {t.assetName}
                  </span>
                )}
                {t.option && (
                  <span
                    className={`text-[11px] font-mono font-semibold px-1.5 py-0.5 rounded ${
                      t.option.optionType === 'call'
                        ? 'bg-emerald-500/15 text-emerald-300'
                        : 'bg-rose-500/15 text-rose-300'
                    }`}
                  >
                    {optionLabel(t.option)}
                  </span>
                )}
              </div>
            </td>
            <td className="px-2 py-1.5 text-right text-surface-700 tabular-nums whitespace-nowrap">
              {t.amount ?? ''}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function FilingsTable({ filings, compact }: { filings: FilingMeta[]; compact: boolean }) {
  if (compact)
    return (
      <div className="space-y-3">
        {filings.slice(0, 2000).map((filing) => (
          <article
            key={`${filing.source}/${filing.docId}`}
            className="rounded-xl border border-border/60 bg-surface-100/50 p-3 space-y-2"
          >
            <h3 className="font-medium text-surface-950 break-words">{filing.filerName}</h3>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
              <dt className="text-surface-600">Date</dt>
              <dd className="text-surface-800">{filing.filingDate ?? '—'}</dd>
              <dt className="text-surface-600">Source</dt>
              <dd className="text-surface-800 break-words">{filing.source}</dd>
              <dt className="text-surface-600">Trades</dt>
              <dd className="text-surface-800">{filing.tradeCount}</dd>
              <dt className="text-surface-600">Parse</dt>
              <dd className="text-surface-800 break-words">{filing.parseMethod}</dd>
            </dl>
            <div className="flex flex-wrap gap-4 text-sm">
              {filing.hasPdf && (
                <a
                  href={`/api/politics/filings/${filing.source}/${filing.docId}/pdf`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-11 items-center gap-1 text-accent-400"
                >
                  <FileText className="size-4" /> PDF
                </a>
              )}
              <a
                href={filing.filingUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-11 items-center gap-1 text-accent-400"
              >
                <ExternalLink className="size-4" /> Source
              </a>
            </div>
          </article>
        ))}
      </div>
    );
  return (
    <table className="w-full text-sm border-collapse">
      <thead className="text-xs uppercase tracking-wide text-surface-500 text-left sticky top-0 bg-surface-0">
        <tr>
          <th className="px-2 py-1.5 font-medium">Date</th>
          <th className="px-2 py-1.5 font-medium">Filer</th>
          <th className="px-2 py-1.5 font-medium">Source</th>
          <th className="px-2 py-1.5 font-medium text-right">Trades</th>
          <th className="px-2 py-1.5 font-medium">Parse</th>
          <th className="px-2 py-1.5 font-medium">Document</th>
        </tr>
      </thead>
      <tbody>
        {filings.slice(0, 2000).map((f) => (
          <tr
            key={`${f.source}/${f.docId}`}
            className="border-t border-border/20 hover:bg-surface-100/50"
          >
            <td className="px-2 py-1.5 text-surface-500 tabular-nums whitespace-nowrap">
              {f.filingDate ?? '—'}
            </td>
            <td className="px-2 py-1.5 text-surface-800">{f.filerName}</td>
            <td className="px-2 py-1.5 text-surface-500">{f.source}</td>
            <td className="px-2 py-1.5 text-right text-surface-700 tabular-nums">{f.tradeCount}</td>
            <td className="px-2 py-1.5">
              <span
                className={`text-[11px] px-1.5 py-0.5 rounded ${
                  f.parseMethod === 'text'
                    ? 'bg-emerald-500/15 text-emerald-300'
                    : f.parseMethod === 'ocr'
                      ? 'bg-amber-500/15 text-amber-300'
                      : 'bg-surface-200/60 text-surface-700'
                }`}
              >
                {f.parseMethod}
              </span>
            </td>
            <td className="px-2 py-1.5">
              <div className="flex items-center gap-2">
                {f.hasPdf && (
                  <a
                    href={`/api/politics/filings/${f.source}/${f.docId}/pdf`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-accent-400 hover:underline"
                  >
                    <FileText className="w-3.5 h-3.5" /> PDF
                  </a>
                )}
                <a
                  href={f.filingUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-surface-500 hover:text-surface-800"
                >
                  <ExternalLink className="w-3.5 h-3.5" /> source
                </a>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function BillsList({ bills }: { bills: Bill[] }) {
  return (
    <div className="space-y-2">
      {bills.map((b, i) => (
        <a
          key={i}
          href={b.url ?? '#'}
          target="_blank"
          rel="noreferrer"
          className="block rounded-lg border border-border/40 bg-surface-100/40 px-3.5 py-2.5 hover:border-border/80"
        >
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-sm text-surface-900">{b.officialId}</span>
            <span className={`text-[11px] px-1.5 py-0.5 rounded ${statusBadge(b.status)}`}>
              {b.status.replace(/_/g, ' ')}
            </span>
          </div>
          <p className="text-sm text-surface-700 mt-1 line-clamp-2">{b.title}</p>
          {b.latestActionDate && (
            <p className="text-xs text-surface-600 mt-1">Latest action {b.latestActionDate}</p>
          )}
        </a>
      ))}
    </div>
  );
}

function ExecList({ actions }: { actions: ExecAction[] }) {
  return (
    <div className="space-y-2">
      {actions.map((e, i) => (
        <a
          key={i}
          href={e.url ?? '#'}
          target="_blank"
          rel="noreferrer"
          className="block rounded-lg border border-border/40 bg-surface-100/40 px-3.5 py-2.5 hover:border-border/80"
        >
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] uppercase tracking-wide text-sky-300">
              {e.type.replace(/_/g, ' ')}
            </span>
            <span className="text-xs text-surface-600 tabular-nums">{e.issuedDate}</span>
          </div>
          <p className="text-sm text-surface-800 mt-1 line-clamp-2">{e.title}</p>
        </a>
      ))}
    </div>
  );
}
