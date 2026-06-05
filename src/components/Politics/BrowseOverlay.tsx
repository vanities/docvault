// Full-screen drill-down browser for the Politics section. Clicking a "Recent X"
// metric on the dashboard opens this over the page: search + filter + see-all for
// trades, bills, executive actions, or archived filings. Closeable back to the
// dashboard (ESC or the X).

import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, FileText, Loader2, Search, X } from 'lucide-react';

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
  return 'bg-surface-700/40 text-surface-300';
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
  const [trades, setTrades] = useState<Trade[] | null>(null);
  const [filings, setFilings] = useState<FilingMeta[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [chamber, setChamber] = useState('all');
  const [direction, setDirection] = useState('all');
  const [optionsOnly, setOptionsOnly] = useState(false);

  // ESC to close + scroll lock.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

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
    <div className="fixed inset-0 z-50 bg-surface-950/95 backdrop-blur-sm flex flex-col">
      <header className="flex items-center justify-between gap-3 px-4 md:px-6 py-3 border-b border-border/60 shrink-0">
        <div className="flex items-center gap-2">
          <h2 className="font-display text-xl text-surface-100">{CATEGORY_LABEL[category]}</h2>
          <span className="text-sm text-surface-500 tabular-nums">{count.toLocaleString()}</span>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-md text-surface-400 hover:text-surface-100 hover:bg-surface-800"
          title="Close (Esc)"
        >
          <X className="w-5 h-5" />
        </button>
      </header>

      <div className="px-4 md:px-6 py-3 border-b border-border/40 shrink-0 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[14rem]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-500" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              category === 'trades'
                ? 'Search ticker, politician, asset…'
                : category === 'filings'
                  ? 'Search filer or doc id…'
                  : 'Search…'
            }
            className="w-full bg-surface-900 border border-border/60 rounded-md pl-8 pr-3 py-1.5 text-sm text-surface-100 placeholder:text-surface-600"
          />
        </div>
        {(category === 'trades' || category === 'filings') && (
          <select
            value={chamber}
            onChange={(e) => setChamber(e.target.value)}
            className="text-sm bg-surface-900 border border-border/60 rounded-md px-2 py-1.5 text-surface-300"
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
              onChange={(e) => setDirection(e.target.value)}
              className="text-sm bg-surface-900 border border-border/60 rounded-md px-2 py-1.5 text-surface-300"
            >
              <option value="all">Buys & sells</option>
              <option value="buy">Buys</option>
              <option value="sell">Sells</option>
            </select>
            <label className="flex items-center gap-1.5 text-sm text-surface-300 px-2">
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

      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-surface-500">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : count === 0 ? (
          <p className="text-center text-surface-600 py-20">Nothing matches.</p>
        ) : category === 'trades' ? (
          <TradesTable trades={visibleTrades} />
        ) : category === 'filings' ? (
          <FilingsTable filings={visibleFilings} />
        ) : category === 'bills' ? (
          <BillsList bills={visibleBills} />
        ) : (
          <ExecList actions={visibleExec} />
        )}
      </div>
    </div>
  );
}

function TradesTable({ trades }: { trades: Trade[] }) {
  return (
    <table className="w-full text-sm border-collapse">
      <thead className="text-xs uppercase tracking-wide text-surface-500 text-left sticky top-0 bg-surface-950">
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
          <tr key={i} className="border-t border-border/20 hover:bg-surface-900/50">
            <td className="px-2 py-1.5 text-surface-500 tabular-nums whitespace-nowrap">
              {t.tradeDate}
            </td>
            <td className="px-2 py-1.5 text-surface-300">{t.politicianName}</td>
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
            <td className="px-2 py-1.5 text-right text-surface-400 tabular-nums whitespace-nowrap">
              {t.amount ?? ''}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function FilingsTable({ filings }: { filings: FilingMeta[] }) {
  return (
    <table className="w-full text-sm border-collapse">
      <thead className="text-xs uppercase tracking-wide text-surface-500 text-left sticky top-0 bg-surface-950">
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
            className="border-t border-border/20 hover:bg-surface-900/50"
          >
            <td className="px-2 py-1.5 text-surface-500 tabular-nums whitespace-nowrap">
              {f.filingDate ?? '—'}
            </td>
            <td className="px-2 py-1.5 text-surface-300">{f.filerName}</td>
            <td className="px-2 py-1.5 text-surface-500">{f.source}</td>
            <td className="px-2 py-1.5 text-right text-surface-400 tabular-nums">{f.tradeCount}</td>
            <td className="px-2 py-1.5">
              <span
                className={`text-[11px] px-1.5 py-0.5 rounded ${
                  f.parseMethod === 'text'
                    ? 'bg-emerald-500/15 text-emerald-300'
                    : f.parseMethod === 'ocr'
                      ? 'bg-amber-500/15 text-amber-300'
                      : 'bg-surface-700/40 text-surface-400'
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
                  className="inline-flex items-center gap-1 text-surface-500 hover:text-surface-300"
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
          className="block rounded-lg border border-border/40 bg-surface-900/40 px-3.5 py-2.5 hover:border-border/80"
        >
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-sm text-surface-200">{b.officialId}</span>
            <span className={`text-[11px] px-1.5 py-0.5 rounded ${statusBadge(b.status)}`}>
              {b.status.replace(/_/g, ' ')}
            </span>
          </div>
          <p className="text-sm text-surface-400 mt-1 line-clamp-2">{b.title}</p>
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
          className="block rounded-lg border border-border/40 bg-surface-900/40 px-3.5 py-2.5 hover:border-border/80"
        >
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] uppercase tracking-wide text-sky-300">
              {e.type.replace(/_/g, ' ')}
            </span>
            <span className="text-xs text-surface-600 tabular-nums">{e.issuedDate}</span>
          </div>
          <p className="text-sm text-surface-300 mt-1 line-clamp-2">{e.title}</p>
        </a>
      ))}
    </div>
  );
}
