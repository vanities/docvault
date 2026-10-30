// Payoff plan: every debt on one timeline, and the month passive income covers
// what the household needs. The math lives in server/debt-plan.ts (pure); this
// view fills in the defaults it can derive (the Income page, the snapshot's
// investments) and saves what's typed to /api/debt-plan.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type BarShapeProps,
} from 'recharts';
import {
  AlertTriangle,
  CalendarClock,
  Coins,
  Loader2,
  Sunrise,
  Table2,
  Wallet,
} from 'lucide-react';
import { API_BASE } from '../../constants';
import { requestJson } from '../../api/client';
import { useAppContext } from '../../contexts/AppContext';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Money } from '../common/Money';
import { formatMonthYear, formatTerm } from '../../utils/amortization';
import type { DebtPaymentItem } from '../../../server/debt-payments';
import {
  DEFAULT_DEBT_PLAN_SETTINGS,
  planDebts,
  projectDebtPlan,
  yearlyPoints,
  type DebtPlanSettings,
  type PayoffOrder,
  type PlanDebt,
} from '../../../server/debt-plan';

// Checked with the dataviz palette validator against the card surface
// (#16181e). Keep the stack in slot order: orange and yellow fail the
// color-blind checks when they touch, and slot order keeps them apart. The
// living fill and both lines clear every debt color.
const DEBT_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500'];
const LIVING_COLOR = '#626a7c';
const DUE_ONLY_COLOR = '#b4bccf';
const PASSIVE_COLOR = '#6ee7b7';
const SURFACE = '#16181e';
const GRID_COLOR = '#24272f';
const AXIS_COLOR = '#2e323c';
const TICK_COLOR = '#8891a5';

const ORDERS: { value: PayoffOrder; label: string }[] = [
  { value: 'avalanche', label: 'Highest rate' },
  { value: 'snowball', label: 'Smallest balance' },
];

type TextKey =
  | 'extraMonthly'
  | 'livingExpenses'
  | 'monthlySavings'
  | 'passiveIncome'
  | 'investments'
  | 'realReturn'
  | 'withdrawalRate';

const TEXT_KEYS: TextKey[] = [
  'extraMonthly',
  'livingExpenses',
  'monthlySavings',
  'passiveIncome',
  'investments',
  'realReturn',
  'withdrawalRate',
];

function formatUsd(value: number): string {
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function formatUsdCompact(value: number): string {
  const short = (n: number) => (Math.abs(n) >= 100 ? n.toFixed(0) : String(+n.toFixed(1)));
  if (Math.abs(value) >= 1_000_000) return `$${short(value / 1_000_000)}M`;
  if (Math.abs(value) >= 1_000) return `$${short(value / 1_000)}K`;
  return `$${value.toFixed(0)}`;
}

/** Round y-axis ticks from 0 past the max: steps of 1, 2, 2.5 or 5 times a power of ten. */
function axisTicks(max: number): number[] {
  if (!(max > 0)) return [0];
  const rough = max / 5;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= rough)!;
  const ticks = [0];
  while (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

const monthName = (ym: string) => formatMonthYear(`${ym}-01`);

function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

/** The saved value as it reads in its input; blank means 0 or "use the default". */
function textOf(key: TextKey, settings: DebtPlanSettings): string {
  const value = settings[key];
  if (value === null) return '';
  if (key === 'realReturn' || key === 'withdrawalRate') return String(+(value * 100).toFixed(2));
  return value === 0 ? '' : String(value);
}

/** What typed text means for a field; undefined while it isn't a usable value yet. */
function parseField(key: TextKey, text: string): number | null | undefined {
  const cleaned = text.replace(/[$,%\s]/g, '');
  if (cleaned === '') {
    if (key === 'passiveIncome' || key === 'investments') return null;
    if (key === 'realReturn' || key === 'withdrawalRate') return DEFAULT_DEBT_PLAN_SETTINGS[key];
    return 0;
  }
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return undefined;
  if (key === 'realReturn') return n >= -20 && n <= 20 ? n / 100 : undefined;
  if (key === 'withdrawalRate') return n > 0 && n <= 20 ? n / 100 : undefined;
  return n >= 0 ? n : undefined;
}

function allText(settings: DebtPlanSettings): Record<TextKey, string> {
  return Object.fromEntries(TEXT_KEYS.map((k) => [k, textOf(k, settings)])) as Record<
    TextKey,
    string
  >;
}

interface Series {
  key: string;
  name: string;
  members: string[];
  color: string;
}

/** One series per debt, up to the four validated colors; past that the rest of the list folds into one. */
function debtSeries(debts: PlanDebt[]): Series[] {
  const one = (d: PlanDebt, i: number): Series => ({
    key: d.key,
    name: d.name,
    members: [d.key],
    color: DEBT_COLORS[i],
  });
  if (debts.length <= DEBT_COLORS.length) return debts.map(one);
  const head = debts.slice(0, DEBT_COLORS.length - 1);
  const rest = debts.slice(DEBT_COLORS.length - 1);
  return [
    ...head.map(one),
    {
      key: 'other',
      name: `${rest.length} more debts`,
      members: rest.map((d) => d.key),
      color: DEBT_COLORS[DEBT_COLORS.length - 1],
    },
  ];
}

const sumOf = (record: Record<string, number>, keys: string[]) =>
  keys.reduce((s, k) => s + (record[k] ?? 0), 0);

// Stacked segments are split by a 2px gap in the surface color rather than an
// outline, and only the top segment of each column gets rounded corners.
function stackSegment(keysAbove: string[]) {
  return function StackSegment({ x, y, width, height, fill, payload }: BarShapeProps) {
    if (!(height > 0) || !(width > 0)) return null;
    const isTop = keysAbove.every((key) => !(Number(payload?.[key]) > 0.5));
    if (!isTop) {
      return height > 2 ? (
        <rect x={x} y={y + 2} width={width} height={height - 2} fill={fill} />
      ) : null;
    }
    const r = Math.min(4, width / 2, height);
    return (
      <path
        d={`M${x},${y + height}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${y + height}Z`}
        fill={fill}
      />
    );
  };
}

interface TooltipRow {
  key: string;
  name: string;
  color: string;
  line?: boolean;
}

interface TooltipEntry {
  dataKey?: unknown;
  value?: unknown;
  payload?: unknown;
}

function PlanTooltip({
  active,
  payload,
  rows,
  sum,
}: {
  active?: boolean;
  payload?: readonly TooltipEntry[];
  rows: TooltipRow[];
  sum: { label: string; keys: string[] };
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload as { label: string; month: string };
  const value = (key: string) => Number(payload.find((p) => p.dataKey === key)?.value ?? 0);
  const shown = rows.filter((r) => value(r.key) > 0.5);
  return (
    <div className="rounded-lg border border-border-strong bg-surface-50 px-3 py-2 text-[11px] shadow-lg min-w-48">
      <p className="mb-1.5 font-medium text-surface-950">
        {point.label === 'Now' ? `Now · ${monthName(point.month)}` : monthName(point.month)}
      </p>
      {shown.map((r) => (
        <div key={r.key} className="flex items-center justify-between gap-4 py-0.5">
          <span className="flex items-center gap-1.5 text-surface-800">
            <span
              className={r.line ? 'h-0.5 w-3 rounded-full' : 'h-2 w-2 rounded-sm'}
              style={{ background: r.color }}
            />
            {r.name}
          </span>
          <span className="font-mono tabular-nums text-surface-950">
            <Money>{formatUsd(value(r.key))}</Money>
          </span>
        </div>
      ))}
      <div className="mt-1 flex justify-between gap-4 border-t border-border-strong pt-1 text-surface-900">
        <span>{sum.label}</span>
        <span className="font-mono tabular-nums">
          <Money>{formatUsd(sum.keys.reduce((s, k) => s + value(k), 0))}</Money>
        </span>
      </div>
    </div>
  );
}

function LegendKey({
  color,
  line,
  children,
}: {
  color: string;
  line?: boolean;
  children: ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={line ? 'h-0.5 w-3.5 rounded-full' : 'h-2.5 w-2.5 rounded-sm'}
        style={{ background: color }}
      />
      {children}
    </span>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof Coins;
  label: string;
  value: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <div className="p-4 rounded-xl border border-border/40 bg-surface-100/30">
      <div className="flex items-center gap-1.5 text-[10px] text-surface-500 uppercase tracking-wider mb-1.5">
        <Icon className="w-3 h-3" />
        {label}
      </div>
      <p className="text-xl font-semibold text-surface-950">{value}</p>
      {detail && <p className="text-[11px] text-surface-600 mt-1">{detail}</p>}
    </div>
  );
}

function Field({
  label,
  hint,
  prefix,
  suffix,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  hint?: ReactNode;
  prefix?: string;
  suffix?: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  // Dollar fields come back filled with saved household amounts on every
  // visit, so the privacy blur covers them the way <Money> covers text.
  const { blurNumbers } = useAppContext();
  const blur = blurNumbers && prefix === '$' ? 'blur-sm' : '';
  return (
    <div>
      <label className="block">
        <span className="text-[11px] text-surface-600 block mb-1">{label}</span>
        <span className="relative block">
          {prefix && (
            <span
              aria-hidden
              className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-surface-500"
            >
              {prefix}
            </span>
          )}
          <Input
            inputMode="decimal"
            value={value}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
            className={`h-9 rounded-lg text-sm ${prefix ? 'pl-7' : ''} ${suffix ? 'pr-8' : ''} ${blur}`}
          />
          {suffix && (
            <span
              aria-hidden
              className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-surface-500"
            >
              {suffix}
            </span>
          )}
        </span>
      </label>
      {hint && <p className="text-[10px] text-surface-500 mt-1">{hint}</p>}
    </div>
  );
}

interface PayoffPlanProps {
  /** The Debts list: every debt with a balance and a monthly payment. */
  items: DebtPaymentItem[];
  /** What the snapshot values today's investments at, by kind: the default for "Investments today". */
  investmentParts: { label: string; value: number }[];
  /** Monthly total of the Income page: the default for passive income. */
  incomeMonthly: number;
}

export function PayoffPlan({ items, investmentParts, incomeMonthly }: PayoffPlanProps) {
  const { blurNumbers } = useAppContext();
  const [settings, setSettings] = useState<DebtPlanSettings>(DEFAULT_DEBT_PLAN_SETTINGS);
  const [text, setText] = useState(() => allText(DEFAULT_DEBT_PLAN_SETTINGS));
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const [showTable, setShowTable] = useState(false);
  const edited = useRef(false);

  useEffect(() => {
    let cancelled = false;
    requestJson<DebtPlanSettings>(`${API_BASE}/debt-plan`)
      .then((saved) => {
        if (cancelled) return;
        setSettings(saved);
        setText(allText(saved));
        setLoadState('ready');
      })
      .catch(() => {
        if (!cancelled) setLoadState('failed');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Save shortly after typing stops. Never after a failed load: that would
  // replace the saved plan with defaults plus whatever was just typed.
  useEffect(() => {
    if (!edited.current || loadState !== 'ready') return;
    const timer = setTimeout(() => {
      setSaveState('saving');
      requestJson(`${API_BASE}/debt-plan`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
        .then(() => setSaveState('saved'))
        .catch(() => setSaveState('failed'));
    }, 700);
    return () => clearTimeout(timer);
  }, [settings, loadState]);

  const edit = (key: TextKey, value: string) => {
    setText((t) => ({ ...t, [key]: value }));
    const parsed = parseField(key, value);
    if (parsed === undefined) return;
    edited.current = true;
    setSettings((s) => ({ ...s, [key]: parsed }));
  };

  const setOrder = (order: PayoffOrder) => {
    edited.current = true;
    setSettings((s) => ({ ...s, order }));
  };

  const setCardsPaidInFull = (cardsPaidInFull: boolean) => {
    edited.current = true;
    setSettings((s) => ({ ...s, cardsPaidInFull }));
  };

  const debts = useMemo(
    () => planDebts(items, settings.cardsPaidInFull),
    [items, settings.cardsPaidInFull]
  );
  const cards = items.filter((d) => d.card);
  const defaultInvestments = investmentParts.reduce((s, p) => s + p.value, 0);
  const passiveIncome = settings.passiveIncome ?? incomeMonthly;
  const investments = settings.investments ?? defaultInvestments;
  const living = settings.livingExpenses;

  const result = useMemo(
    () =>
      projectDebtPlan({
        debts,
        extraMonthly: settings.extraMonthly,
        order: settings.order,
        livingExpenses: settings.livingExpenses,
        monthlySavings: settings.monthlySavings,
        passiveIncome,
        investments,
        realReturn: settings.realReturn,
        withdrawalRate: settings.withdrawalRate,
      }),
    [debts, settings, passiveIncome, investments]
  );

  const series = useMemo(() => debtSeries(debts), [debts]);
  const seriesKeys = series.map((s) => s.key);
  const { points, labels, owedRows, needsRows, owedTicks, needsTicks } = useMemo(() => {
    const pts = yearlyPoints(result.months);
    const lbls = pts.map((m, i) => (i === 0 ? 'Now' : m.month.slice(0, 4)));
    return {
      points: pts,
      labels: lbls,
      owedRows: pts.map((m, i) => ({
        label: lbls[i],
        month: m.month,
        dueOnly: m.totalOwedAsScheduled,
        ...Object.fromEntries(series.map((s) => [s.key, sumOf(m.owed, s.members)])),
      })),
      needsRows: pts.map((m, i) => ({
        label: lbls[i],
        month: m.month,
        living,
        passive: m.passive,
        ...Object.fromEntries(series.map((s) => [s.key, sumOf(m.payments, s.members)])),
      })),
      owedTicks: axisTicks(
        Math.max(...pts.map((m) => Math.max(m.totalOwed, m.totalOwedAsScheduled)))
      ),
      needsTicks: axisTicks(Math.max(...pts.map((m) => Math.max(m.needs, m.passive)))),
    };
  }, [result, series, living]);

  /** The chart column a month falls in: the first year-end point at or after it. */
  const columnFor = (month: string | null) => {
    if (!month) return undefined;
    const i = points.findIndex((p) => p.month >= month);
    return i === -1 ? undefined : labels[i];
  };
  const seriesPaidOff = (s: Series) => {
    const dates = s.members.map((k) => result.paidOff[k]);
    return dates.some((d) => d === null) ? null : (dates as string[]).sort().at(-1)!;
  };

  if (loadState === 'loading') {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="w-5 h-5 text-accent-400 animate-spin" />
      </div>
    );
  }

  const now = result.months[0].month;
  const owedNow = result.months[0].totalOwed;
  const scheduledNow = result.months[0].needs - living;
  const fewerMonths =
    result.debtFree && result.debtFreeAsScheduled
      ? monthsBetween(result.debtFree, result.debtFreeAsScheduled)
      : 0;
  const growingNames = result.growing.map((k) => debts.find((d) => d.key === k)!.name);
  const axisMoney = blurNumbers ? () => '$•••' : formatUsdCompact;
  const masked = (value: number) =>
    blurNumbers ? '•••' : Math.round(value).toLocaleString('en-US');
  const owedTooltipRows: TooltipRow[] = [
    ...series,
    { key: 'dueOnly', name: 'Paying only what’s due', color: DUE_ONLY_COLOR, line: true },
  ];
  const needsTooltipRows: TooltipRow[] = [
    { key: 'living', name: 'Living expenses', color: LIVING_COLOR },
    ...series,
    { key: 'passive', name: 'Passive income', color: PASSIVE_COLOR, line: true },
  ];
  const debtFreeAt = owedNow > 0 ? columnFor(result.debtFree) : undefined;
  const freeAt = columnFor(result.free);
  const axisProps = {
    tick: { fontSize: 10, fill: TICK_COLOR },
    tickLine: false,
  } as const;

  let freeValue: ReactNode;
  let freeDetail: ReactNode;
  if (living <= 0) {
    freeValue = '—';
    freeDetail = 'Enter your living expenses below';
  } else if (result.free === now) {
    freeValue = 'Now';
    freeDetail = 'Passive income already covers what you need each month';
  } else if (result.free) {
    freeValue = monthName(result.free);
    freeDetail = `in ${formatTerm(monthsBetween(now, result.free))}`;
  } else {
    freeValue = 'Not within 50 years';
    freeDetail = 'At these numbers, passive income doesn’t catch up';
  }

  return (
    <div className="space-y-4">
      <p className="text-[13px] text-surface-600">
        Every debt on one timeline. The plan keeps paying the same total each month: when a debt is
        paid off, its payment moves to the next one, and once nothing is owed it goes to
        investments.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Stat
          icon={CalendarClock}
          label="Debt-free"
          value={
            owedNow <= 0
              ? 'Now'
              : result.debtFree
                ? monthName(result.debtFree)
                : 'Not within 50 years'
          }
          detail={
            result.debtFree && owedNow > 0
              ? `in ${formatTerm(monthsBetween(now, result.debtFree))}${
                  fewerMonths > 0
                    ? `, ${formatTerm(fewerMonths)} sooner than paying only what’s due`
                    : ''
                }`
              : undefined
          }
        />
        <Stat icon={Sunrise} label="Financially free" value={freeValue} detail={freeDetail} />
        <Stat
          icon={Wallet}
          label="Going out each month"
          value={<Money>{formatUsd(scheduledNow + living + settings.extraMonthly)}</Money>}
          detail={
            <>
              <Money>{formatUsd(scheduledNow + settings.extraMonthly)}</Money> to debt
              {living > 0 ? (
                <>
                  {' '}
                  + <Money>{formatUsd(living)}</Money> living expenses
                </>
              ) : (
                ', before living expenses'
              )}
            </>
          }
        />
        <Stat
          icon={Coins}
          label="Interest left"
          value={<Money>{formatUsd(result.interest)}</Money>}
          detail={
            result.interestAsScheduled - result.interest > 1 ? (
              <>
                <Money>{formatUsd(result.interestAsScheduled - result.interest)}</Money> less than
                paying only what’s due
              </>
            ) : undefined
          }
        />
      </div>

      {growingNames.length > 0 && (
        <div className="flex items-start gap-2 p-3 rounded-xl border border-amber-500/30 bg-amber-500/10 text-[12px] text-amber-200">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <p>
            {growingNames.join(', ')}: the payment doesn&apos;t cover the interest, so on its own
            payment it never gets paid off. Only the plan&apos;s extra and rolled-over payments
            clear it.
          </p>
        </div>
      )}

      <Card variant="glass" className="p-5 space-y-5">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-[14px] font-semibold text-surface-950">Your numbers</h3>
          <span className="text-[11px] text-surface-500">
            {loadState === 'failed'
              ? 'Couldn’t load your saved plan, so changes here aren’t saved'
              : saveState === 'saving'
                ? 'Saving…'
                : saveState === 'saved'
                  ? 'Saved'
                  : saveState === 'failed'
                    ? 'Couldn’t save'
                    : ''}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field
            label="Extra toward debt / month"
            prefix="$"
            value={text.extraMonthly}
            placeholder="0"
            onChange={(v) => edit('extraMonthly', v)}
          />
          <div>
            <span className="text-[11px] text-surface-600 block mb-1">Pay off first</span>
            <div className="inline-flex rounded-lg border border-border bg-surface-100 p-0.5">
              {ORDERS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  aria-pressed={settings.order === o.value}
                  onClick={() => setOrder(o.value)}
                  className={`h-8 px-3 rounded-md text-[12px] transition-colors ${
                    settings.order === o.value
                      ? 'bg-surface-300 text-surface-950'
                      : 'text-surface-600 hover:text-surface-900'
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          {cards.length > 0 && (
            <label className="sm:col-span-2 flex items-start gap-2 text-[13px] text-surface-900">
              <input
                type="checkbox"
                checked={settings.cardsPaidInFull}
                onChange={(e) => setCardsPaidInFull(e.target.checked)}
                className="accent-emerald-500 mt-0.5"
              />
              <span>
                I pay my credit cards in full every month
                <span className="block text-[11px] text-surface-600">
                  Leaves {cards.length === 1 ? 'the card' : `${cards.length} cards`} (
                  <Money>{formatUsd(cards.reduce((s, c) => s + c.balance, 0))}</Money> owed now) out
                  of the debts: what you charge each month belongs in living expenses.
                </span>
              </span>
            </label>
          )}
          <Field
            label="Living expenses / month"
            prefix="$"
            value={text.livingExpenses}
            placeholder="Not counting debt payments"
            hint="Groceries, utilities, insurance, gas, and what goes on your cards: everything except the debt payments above"
            onChange={(v) => edit('livingExpenses', v)}
          />
          <Field
            label="Saving & investing / month"
            prefix="$"
            value={text.monthlySavings}
            placeholder="0"
            hint="What you add to investments now, not counting debt payments"
            onChange={(v) => edit('monthlySavings', v)}
          />
          <Field
            label="Passive income / month"
            prefix="$"
            value={text.passiveIncome}
            placeholder={masked(incomeMonthly)}
            hint={
              <>
                Income that keeps coming if you stop working. Blank uses your Income page (
                <Money>{formatUsd(incomeMonthly)}</Money>/mo)
              </>
            }
            onChange={(v) => edit('passiveIncome', v)}
          />
          <Field
            label="Investments today"
            prefix="$"
            value={text.investments}
            placeholder={masked(defaultInvestments)}
            hint={
              investmentParts.length > 0 ? (
                <>
                  Blank uses{' '}
                  {investmentParts.map((p, i) => (
                    <span key={p.label}>
                      {i > 0 && ' + '}
                      {p.label.toLowerCase()} <Money>{formatUsdCompact(p.value)}</Money>
                    </span>
                  ))}
                </>
              ) : undefined
            }
            onChange={(v) => edit('investments', v)}
          />
          <Field
            label="Growth after inflation / year"
            suffix="%"
            value={text.realReturn}
            onChange={(v) => edit('realReturn', v)}
          />
          <Field
            label="Withdrawal rate / year"
            suffix="%"
            value={text.withdrawalRate}
            hint="The share of investments you'd draw each year once free"
            onChange={(v) => edit('withdrawalRate', v)}
          />
        </div>
      </Card>

      {owedNow > 0 && (
        <Card variant="glass" className="p-5">
          <h3 className="text-[14px] font-semibold text-surface-950">What you owe, year by year</h3>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-2 mb-3 text-[11px] text-surface-700">
            {series.map((s) => {
              const done = seriesPaidOff(s);
              return (
                <LegendKey key={s.key} color={s.color}>
                  {s.name}
                  <span className="text-surface-500">
                    {done ? ` · paid off ${monthName(done)}` : ' · not within 50 years'}
                  </span>
                </LegendKey>
              );
            })}
            <LegendKey color={DUE_ONLY_COLOR} line>
              Paying only what&apos;s due
            </LegendKey>
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={owedRows} margin={{ top: 16, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={GRID_COLOR} vertical={false} />
              <XAxis
                dataKey="label"
                {...axisProps}
                axisLine={{ stroke: AXIS_COLOR }}
                interval="preserveStartEnd"
                minTickGap={12}
              />
              <YAxis
                {...axisProps}
                axisLine={false}
                tickFormatter={axisMoney}
                width={52}
                ticks={owedTicks}
                domain={[0, owedTicks[owedTicks.length - 1]]}
              />
              <Tooltip
                cursor={{ fill: 'rgba(148,163,184,0.06)' }}
                content={(p) => (
                  <PlanTooltip
                    active={p.active}
                    payload={p.payload}
                    rows={owedTooltipRows}
                    sum={{ label: 'Owed', keys: seriesKeys }}
                  />
                )}
              />
              {series.map((s, i) => (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  stackId="owed"
                  fill={s.color}
                  maxBarSize={24}
                  isAnimationActive={false}
                  shape={stackSegment(seriesKeys.slice(i + 1))}
                />
              ))}
              <Line
                type="monotone"
                dataKey="dueOnly"
                stroke={DUE_ONLY_COLOR}
                strokeWidth={2}
                strokeLinecap="round"
                dot={false}
                activeDot={{ r: 4, stroke: SURFACE, strokeWidth: 2 }}
                isAnimationActive={false}
              />
              {debtFreeAt && (
                <ReferenceLine
                  x={debtFreeAt}
                  stroke={TICK_COLOR}
                  strokeOpacity={0.5}
                  label={{
                    value: 'Debt-free',
                    position: 'insideTopLeft',
                    fill: TICK_COLOR,
                    fontSize: 10,
                  }}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </Card>
      )}

      <Card variant="glass" className="p-5">
        <h3 className="text-[14px] font-semibold text-surface-950">
          What you need each month vs. passive income
        </h3>
        {living <= 0 ? (
          <p className="text-[12px] text-surface-500 mt-2">
            Enter your monthly living expenses above to see when passive income covers them.
          </p>
        ) : (
          <>
            <p className="text-[11px] text-surface-500 mt-1">
              Financially free is where the line clears the bars: living expenses plus the debt
              payments still due.
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-2 mb-3 text-[11px] text-surface-700">
              <LegendKey color={LIVING_COLOR}>Living expenses</LegendKey>
              {series.map((s) => (
                <LegendKey key={s.key} color={s.color}>
                  {s.name}
                </LegendKey>
              ))}
              <LegendKey color={PASSIVE_COLOR} line>
                Passive income
              </LegendKey>
            </div>
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={needsRows} margin={{ top: 16, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={GRID_COLOR} vertical={false} />
                <XAxis
                  dataKey="label"
                  {...axisProps}
                  axisLine={{ stroke: AXIS_COLOR }}
                  interval="preserveStartEnd"
                  minTickGap={12}
                />
                <YAxis
                  {...axisProps}
                  axisLine={false}
                  tickFormatter={axisMoney}
                  width={52}
                  ticks={needsTicks}
                  domain={[0, needsTicks[needsTicks.length - 1]]}
                />
                <Tooltip
                  cursor={{ fill: 'rgba(148,163,184,0.06)' }}
                  content={(p) => (
                    <PlanTooltip
                      active={p.active}
                      payload={p.payload}
                      rows={needsTooltipRows}
                      sum={{ label: 'Needs', keys: ['living', ...seriesKeys] }}
                    />
                  )}
                />
                <Bar
                  dataKey="living"
                  stackId="needs"
                  fill={LIVING_COLOR}
                  maxBarSize={24}
                  isAnimationActive={false}
                  shape={stackSegment(seriesKeys)}
                />
                {series.map((s, i) => (
                  <Bar
                    key={s.key}
                    dataKey={s.key}
                    stackId="needs"
                    fill={s.color}
                    maxBarSize={24}
                    isAnimationActive={false}
                    shape={stackSegment(seriesKeys.slice(i + 1))}
                  />
                ))}
                <Line
                  type="monotone"
                  dataKey="passive"
                  stroke={PASSIVE_COLOR}
                  strokeWidth={2}
                  strokeLinecap="round"
                  dot={false}
                  activeDot={{ r: 4, stroke: SURFACE, strokeWidth: 2 }}
                  isAnimationActive={false}
                />
                {freeAt && (
                  <ReferenceLine
                    x={freeAt}
                    stroke={PASSIVE_COLOR}
                    strokeOpacity={0.5}
                    label={{
                      value: 'Financially free',
                      position: 'insideTopLeft',
                      fill: TICK_COLOR,
                      fontSize: 10,
                    }}
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </>
        )}
      </Card>

      <div>
        <Button variant="ghost" size="xs" onClick={() => setShowTable((v) => !v)}>
          <Table2 />
          {showTable ? 'Hide year by year' : 'Show year by year'}
        </Button>
        {showTable && (
          <div className="mt-2 overflow-x-auto rounded-xl border border-border/40">
            <table className="w-full text-[11px]">
              <thead className="text-surface-500">
                <tr className="text-right">
                  <th className="px-3 py-2 text-left font-medium">Year end</th>
                  <th className="px-3 py-2 font-medium">Owed</th>
                  <th className="px-3 py-2 font-medium">Paying only what&apos;s due</th>
                  <th className="px-3 py-2 font-medium">Needs / mo</th>
                  <th className="px-3 py-2 font-medium">Passive / mo</th>
                  <th className="px-3 py-2 font-medium">Invested</th>
                </tr>
              </thead>
              <tbody className="font-mono tabular-nums text-surface-900">
                {points.map((m, i) => (
                  <tr key={m.month} className="border-t border-border/30 text-right">
                    <td className="px-3 py-1.5 text-left font-sans">
                      {i === 0 ? `Now (${monthName(m.month)})` : monthName(m.month)}
                    </td>
                    <td className="px-3 py-1.5">
                      <Money>{formatUsd(m.totalOwed)}</Money>
                    </td>
                    <td className="px-3 py-1.5">
                      <Money>{formatUsd(m.totalOwedAsScheduled)}</Money>
                    </td>
                    <td className="px-3 py-1.5">
                      <Money>{formatUsd(m.needs)}</Money>
                    </td>
                    <td className="px-3 py-1.5">
                      <Money>{formatUsd(m.passive)}</Money>
                    </td>
                    <td className="px-3 py-1.5">
                      <Money>{formatUsd(m.invested)}</Money>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-[10px] text-surface-500">
        Projection in today&apos;s dollars; nothing here changes your saved debts. Rates and
        payments stay fixed, and a debt with no rate saved counts as 0%. A mortgage payment that
        includes escrow pays off later than shown. Investments grow at the rate above after
        inflation, and once free you&apos;d draw the withdrawal rate each year.
      </p>
    </div>
  );
}
