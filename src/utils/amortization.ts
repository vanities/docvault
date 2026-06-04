// Loan amortization engine.
//
// Pure, deterministic math — no I/O, no personal data. Given a current balance,
// an annual rate, and a regular monthly payment, it projects the month-by-month
// payoff schedule. It can also model extra principal (recurring and/or one-time)
// so callers can answer "pay $X more and save how much time / interest?".
//
// All money values are full-precision; round only at the display layer.

export interface AmortizationParams {
  /** Current outstanding principal. */
  balance: number;
  /** Annual interest rate as a decimal (e.g. 0.0713 for 7.13%). */
  annualRate: number;
  /** Regular monthly payment (principal + interest). */
  monthlyPayment: number;
  /** Recurring additional principal applied every month. */
  extraMonthly?: number;
  /** A single additional principal payment. */
  oneTimeExtra?: number;
  /** 1-based month index at which the one-time payment lands (default 1 = now). */
  oneTimeMonthIndex?: number;
  /** Month the schedule starts from; defaults to the first of the current month. */
  startDate?: Date;
  /** Hard cap on iterations to avoid runaway loops (default 1200 months = 100 yr). */
  maxMonths?: number;
}

export interface AmortizationRow {
  /** 1-based payment number. */
  monthIndex: number;
  /** First-of-month ISO date (YYYY-MM-DD) this payment is due. */
  date: string;
  /** Cash paid this month (interest + principal + extra), trimmed on the final month. */
  payment: number;
  /** Interest portion. */
  interest: number;
  /** Scheduled principal portion (excludes extra). */
  principal: number;
  /** Additional principal beyond the scheduled payment. */
  extra: number;
  /** Remaining balance after this payment. */
  balance: number;
  /** Running total of interest paid through this month. */
  cumulativeInterest: number;
  /** Running total of principal retired through this month. */
  cumulativePrincipal: number;
}

export interface AmortizationResult {
  rows: AmortizationRow[];
  /** Number of payments until payoff. */
  months: number;
  /** ISO date of the final payment, or null if it never amortizes. */
  payoffDate: string | null;
  totalInterest: number;
  /** Total of all payments (principal + interest). */
  totalPaid: number;
  /** True when the payment doesn't cover the first month's interest (balance would grow). */
  negativeAmortization: boolean;
  /** First month's interest charge — the floor a payment must clear to make progress. */
  firstMonthInterest: number;
}

function firstOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Project a loan's payoff schedule.
 *
 * The balance falls each month by (payment − interest) plus any extra principal.
 * Because the payment is fixed while interest shrinks with the balance, the
 * principal portion can only grow over time — so negative amortization, if it
 * happens at all, happens on the very first month and is reported as such.
 */
export function buildAmortization(params: AmortizationParams): AmortizationResult {
  const {
    balance: startBalance,
    annualRate,
    monthlyPayment,
    extraMonthly = 0,
    oneTimeExtra = 0,
    oneTimeMonthIndex = 1,
    startDate,
    maxMonths = 1200,
  } = params;

  const monthlyRate = annualRate / 12;
  const start = firstOfMonth(startDate ?? new Date());
  const firstMonthInterest = startBalance * monthlyRate;

  const rows: AmortizationRow[] = [];
  let balance = startBalance;
  let cumulativeInterest = 0;
  let cumulativePrincipal = 0;
  let negativeAmortization = false;

  if (startBalance > 0 && monthlyPayment > 0) {
    for (let month = 1; month <= maxMonths && balance > 0.005; month++) {
      const interest = balance * monthlyRate;
      const scheduledPrincipal = monthlyPayment - interest;
      const plannedExtra = extraMonthly + (month === oneTimeMonthIndex ? oneTimeExtra : 0);
      const desiredReduction = scheduledPrincipal + plannedExtra;

      // Payment (plus any extra this month) can't even cover interest → balance
      // can never fall. Flag it and stop rather than loop forever.
      if (desiredReduction <= 0) {
        negativeAmortization = true;
        break;
      }

      // Don't overpay past zero on the final month.
      const principalPaid = Math.min(desiredReduction, balance);
      const basePrincipal = Math.min(Math.max(scheduledPrincipal, 0), principalPaid);
      const extra = principalPaid - basePrincipal;

      balance -= principalPaid;
      cumulativeInterest += interest;
      cumulativePrincipal += principalPaid;

      rows.push({
        monthIndex: month,
        date: toISODate(addMonths(start, month - 1)),
        payment: interest + principalPaid,
        interest,
        principal: basePrincipal,
        extra,
        balance: balance < 0.005 ? 0 : balance,
        cumulativeInterest,
        cumulativePrincipal,
      });
    }
  }

  const last = rows[rows.length - 1];
  return {
    rows,
    months: rows.length,
    payoffDate: last ? last.date : null,
    totalInterest: cumulativeInterest,
    totalPaid: cumulativePrincipal + cumulativeInterest,
    negativeAmortization,
    firstMonthInterest,
  };
}

export interface AmortizationComparison {
  base: AmortizationResult;
  scenario: AmortizationResult;
  /** Payments shaved off by the extra principal (base − scenario). */
  monthsSaved: number;
  /** Interest avoided by the extra principal (base − scenario). */
  interestSaved: number;
}

/**
 * Compare the loan as scheduled (`base`) against the same loan with extra
 * principal (`scenario`), reporting time and interest saved.
 */
export function compareAmortization(
  loan: Pick<
    AmortizationParams,
    'balance' | 'annualRate' | 'monthlyPayment' | 'startDate' | 'maxMonths'
  >,
  extra: Pick<AmortizationParams, 'extraMonthly' | 'oneTimeExtra' | 'oneTimeMonthIndex'>
): AmortizationComparison {
  const base = buildAmortization(loan);
  const scenario = buildAmortization({ ...loan, ...extra });
  return {
    base,
    scenario,
    monthsSaved: base.months - scenario.months,
    interestSaved: base.totalInterest - scenario.totalInterest,
  };
}

/** Format a month count as "Xy Ym" (e.g. 172 → "14 yr 4 mo"). */
export function formatTerm(months: number): string {
  if (!Number.isFinite(months) || months <= 0) return '—';
  const years = Math.floor(months / 12);
  const rem = months % 12;
  if (years === 0) return `${rem} mo`;
  if (rem === 0) return `${years} yr`;
  return `${years} yr ${rem} mo`;
}

/** Format an ISO date (YYYY-MM-DD) as a short "Mon YYYY" label. */
export function formatMonthYear(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}
