import { useMemo, useState } from 'react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { AlertTriangle, TrendingDown, CalendarClock, Coins, Wallet } from 'lucide-react';
import { useAppContext } from '../../contexts/AppContext';
import { Money } from './Money';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  buildAmortization,
  formatTerm,
  formatMonthYear,
  type AmortizationResult,
  type AmortizationRow,
} from '../../utils/amortization';

interface LoanAmortizationProps {
  /** Display name of the loan (e.g. property or debt name). */
  name: string;
  lender?: string;
  /** Current outstanding balance. */
  balance: number;
  /** Annual rate as a decimal (e.g. 0.0713). */
  annualRate: number;
  /** Regular monthly payment. */
  monthlyPayment: number;
}

const COLOR_BASE = '#64748b'; // slate-500 — "as scheduled"
const COLOR_EXTRA = '#10b981'; // emerald-500 — "with extra"
const COLOR_INTEREST = '#f43f5e'; // rose-500
const COLOR_PRINCIPAL = '#06b6d4'; // cyan-500

function formatUsdCompact(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

function formatUsdFull(value: number): string {
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function parseMoney(value: string): number {
  const n = Number(value.replace(/[,$\s]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

interface BalancePoint {
  label: string;
  base: number;
  scenario: number;
}

/** Year-end balances for both schedules, aligned on a shared year axis. */
function buildBalanceSeries(
  base: AmortizationResult,
  scenario: AmortizationResult,
  startBalance: number,
  hasExtra: boolean
): BalancePoint[] {
  const yearEnd = (rows: AmortizationRow[]): Map<string, number> => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.date.slice(0, 4), r.balance); // last write per year = Dec balance
    return m;
  };
  const baseMap = yearEnd(base.rows);
  const scenMap = yearEnd(scenario.rows);
  const points: BalancePoint[] = [{ label: 'Now', base: startBalance, scenario: startBalance }];
  if (base.rows.length === 0) return points;

  const startYear = Number(base.rows[0].date.slice(0, 4));
  const endYear = Number(base.rows[base.rows.length - 1].date.slice(0, 4));
  for (let y = startYear; y <= endYear; y++) {
    const key = String(y);
    const baseBal = baseMap.get(key) ?? 0; // 0 once paid off
    points.push({
      label: key,
      base: baseBal,
      scenario: hasExtra ? (scenMap.get(key) ?? 0) : baseBal,
    });
  }
  return points;
}

interface YearSplit {
  year: string;
  interest: number;
  principal: number;
}

/** Sum interest vs principal (incl. extra) per calendar year. */
function aggregateByYear(rows: AmortizationRow[]): YearSplit[] {
  const map = new Map<string, YearSplit>();
  for (const r of rows) {
    const y = r.date.slice(0, 4);
    const agg = map.get(y) ?? { year: y, interest: 0, principal: 0 };
    agg.interest += r.interest;
    agg.principal += r.principal + r.extra;
    map.set(y, agg);
  }
  return [...map.values()];
}

function StatCell({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Coins;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="p-3 rounded-xl border border-border/40 bg-surface-100/30">
      <div className="flex items-center gap-1.5 text-[10px] text-surface-500 uppercase tracking-wider mb-1">
        <Icon className="w-3 h-3" />
        {label}
      </div>
      <p className="text-[15px] font-mono font-semibold tabular-nums text-surface-950">
        {children}
      </p>
    </div>
  );
}

export function LoanAmortization({
  name,
  lender,
  balance,
  annualRate,
  monthlyPayment,
}: LoanAmortizationProps) {
  const { blurNumbers } = useAppContext();
  const [extraMonthly, setExtraMonthly] = useState('');
  const [oneTime, setOneTime] = useState('');

  const extraMonthlyNum = parseMoney(extraMonthly);
  const oneTimeNum = parseMoney(oneTime);
  const hasExtra = extraMonthlyNum > 0 || oneTimeNum > 0;

  const { base, scenario } = useMemo(() => {
    const loan = { balance, annualRate, monthlyPayment };
    return {
      base: buildAmortization(loan),
      scenario: buildAmortization({
        ...loan,
        extraMonthly: extraMonthlyNum,
        oneTimeExtra: oneTimeNum,
        oneTimeMonthIndex: 1,
      }),
    };
  }, [balance, annualRate, monthlyPayment, extraMonthlyNum, oneTimeNum]);

  const monthsSaved = base.months - scenario.months;
  const interestSaved = base.totalInterest - scenario.totalInterest;

  const balanceSeries = useMemo(
    () => buildBalanceSeries(base, scenario, balance, hasExtra),
    [base, scenario, balance, hasExtra]
  );
  const yearSplits = useMemo(
    () => aggregateByYear(hasExtra ? scenario.rows : base.rows),
    [base, scenario, hasExtra]
  );

  const blurAxis = blurNumbers ? () => '$•••' : formatUsdCompact;
  const tooltipStyle = {
    background: '#1e293b',
    border: '1px solid rgba(148,163,184,0.1)',
    borderRadius: 10,
    fontSize: 12,
    color: '#f8fafc',
    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
  } as const;

  // --- Guard rails ---------------------------------------------------------
  if (!(balance > 0) || !(monthlyPayment > 0) || !Number.isFinite(annualRate)) {
    return (
      <p className="text-[12px] text-surface-500">
        Add a balance, rate, and monthly payment to project this loan&apos;s payoff.
      </p>
    );
  }

  if (base.negativeAmortization) {
    return (
      <div className="flex items-start gap-2 p-3 rounded-xl border border-rose-500/30 bg-rose-500/10 text-[12px] text-rose-300">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
        <div>
          The {formatUsdFull(monthlyPayment)}/mo payment doesn&apos;t cover the first month&apos;s
          interest of <Money>{formatUsdFull(base.firstMonthInterest)}</Money>, so the balance would
          grow rather than shrink. A payment above the interest charge is required to pay this loan
          down.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-[13px] font-medium text-surface-900">
          Payoff projection
          {lender && <span className="text-surface-500 font-normal"> · {lender}</span>}
        </p>
        <p className="text-[11px] text-surface-500 font-mono tabular-nums">
          {(annualRate * 100).toFixed(2)}% · <Money>{formatUsdFull(monthlyPayment)}</Money>/mo
        </p>
      </div>

      {/* Baseline summary (as scheduled) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <StatCell icon={CalendarClock} label="Debt-free by">
          {formatMonthYear(base.payoffDate)}
        </StatCell>
        <StatCell icon={TrendingDown} label="Time left">
          {formatTerm(base.months)}
        </StatCell>
        <StatCell icon={Coins} label="Interest left">
          <Money>{formatUsdFull(base.totalInterest)}</Money>
        </StatCell>
        <StatCell icon={Wallet} label="Total payments">
          <Money>{formatUsdFull(base.totalPaid)}</Money>
        </StatCell>
      </div>

      {/* Extra-payment what-if */}
      <div className="p-4 rounded-xl border border-border/40 bg-surface-100/30 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-[12px] font-semibold text-surface-900">Add extra payments</p>
          {hasExtra && (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => {
                setExtraMonthly('');
                setOneTime('');
              }}
            >
              Reset
            </Button>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] text-surface-600 block mb-1">
              Extra principal / month
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-surface-500">
                $
              </span>
              <Input
                type="number"
                inputMode="decimal"
                min="0"
                value={extraMonthly}
                onChange={(e) => setExtraMonthly(e.target.value)}
                placeholder="0"
                className="h-9 rounded-lg text-sm pl-7"
              />
            </div>
          </div>
          <div>
            <label className="text-[11px] text-surface-600 block mb-1">One-time extra (now)</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-surface-500">
                $
              </span>
              <Input
                type="number"
                inputMode="decimal"
                min="0"
                value={oneTime}
                onChange={(e) => setOneTime(e.target.value)}
                placeholder="0"
                className="h-9 rounded-lg text-sm pl-7"
              />
            </div>
          </div>
        </div>

        {hasExtra && (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 pt-1 text-[12px]">
            <span className="inline-flex items-center gap-1.5 text-emerald-400 font-medium">
              <TrendingDown className="w-3.5 h-3.5" />
              {monthsSaved > 0 ? `${formatTerm(monthsSaved)} sooner` : 'No time saved'}
            </span>
            <span className="text-surface-700">
              Interest saved{' '}
              <span className="font-mono font-semibold text-emerald-400 tabular-nums">
                <Money>{formatUsdFull(Math.max(interestSaved, 0))}</Money>
              </span>
            </span>
            <span className="text-surface-700">
              New payoff{' '}
              <span className="font-mono font-semibold text-surface-950 tabular-nums">
                {formatMonthYear(scenario.payoffDate)}
              </span>
            </span>
          </div>
        )}
      </div>

      {/* Balance payoff curve */}
      {balanceSeries.length >= 2 && (
        <div className="rounded-xl border border-border/40 bg-surface-100/30 p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[12px] font-semibold text-surface-900">Balance over time</p>
            {hasExtra && (
              <div className="flex items-center gap-3 text-[10px] text-surface-500">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full" style={{ background: COLOR_BASE }} />
                  As scheduled
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full" style={{ background: COLOR_EXTRA }} />
                  With extra
                </span>
              </div>
            )}
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={balanceSeries} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="rgba(148,163,184,0.08)"
                vertical={false}
              />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: '#64748b' }}
                axisLine={false}
                tickLine={false}
                minTickGap={24}
              />
              <YAxis
                tick={{ fontSize: 10, fill: '#64748b' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={blurAxis}
                width={48}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                formatter={(value: any, key: any) => [
                  blurNumbers ? '$•••' : formatUsdFull(Number(value)),
                  key === 'scenario' ? 'With extra' : 'As scheduled',
                ]}
              />
              <Line
                type="monotone"
                dataKey="base"
                stroke={COLOR_BASE}
                strokeWidth={hasExtra ? 1.5 : 2}
                dot={false}
                strokeDasharray={hasExtra ? '4 3' : undefined}
              />
              {hasExtra && (
                <Line
                  type="monotone"
                  dataKey="scenario"
                  stroke={COLOR_EXTRA}
                  strokeWidth={2}
                  dot={false}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Interest vs principal per year */}
      {yearSplits.length >= 1 && (
        <div className="rounded-xl border border-border/40 bg-surface-100/30 p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[12px] font-semibold text-surface-900">
              Where each year&apos;s payments go
            </p>
            <div className="flex items-center gap-3 text-[10px] text-surface-500">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-sm" style={{ background: COLOR_PRINCIPAL }} />
                Principal
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-sm" style={{ background: COLOR_INTEREST }} />
                Interest
              </span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={yearSplits} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="rgba(148,163,184,0.08)"
                vertical={false}
              />
              <XAxis
                dataKey="year"
                tick={{ fontSize: 10, fill: '#64748b' }}
                axisLine={false}
                tickLine={false}
                minTickGap={16}
              />
              <YAxis
                tick={{ fontSize: 10, fill: '#64748b' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={blurAxis}
                width={48}
              />
              <Tooltip
                cursor={{ fill: 'rgba(148,163,184,0.06)' }}
                contentStyle={tooltipStyle}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                formatter={(value: any, key: any) => [
                  blurNumbers ? '$•••' : formatUsdFull(Number(value)),
                  key === 'interest' ? 'Interest' : 'Principal',
                ]}
              />
              <Bar dataKey="principal" stackId="p" fill={COLOR_PRINCIPAL} radius={[0, 0, 0, 0]} />
              <Bar dataKey="interest" stackId="p" fill={COLOR_INTEREST} radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <p className="text-[10px] text-surface-500">
        Projection only — figures assume a fixed rate and payment and don&apos;t change any saved
        data. {name} balance amortized from today forward.
      </p>
    </div>
  );
}
