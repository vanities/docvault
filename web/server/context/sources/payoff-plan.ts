import { loadDebtPlan } from '../../data.js';
import {
  buildPlan,
  monthsBetween,
  planDefaults,
  planOutlook,
  type DebtPlanSettings,
  type PlanOutlook,
  type PlanSetup,
  type PlanSnapshot,
} from '../../debt-plan.js';
import { financialSnapshotJson } from '../../routes/financial-snapshot.js';
import { money, percent } from '../format.js';
import { ReadCollector, windowTest } from '../request.js';
import type { ContextSource } from '../types.js';

/** A debt id is `source:name` (debtId in debt-plan.ts); readers want the name. */
const debtName = (id: string) => id.split(':').slice(1).join(':') || id;

/** The saved plan as lines. Pure. */
export function describePayoffPlan(s: DebtPlanSettings): string[] {
  const lines = [
    `Payoff plan: ${s.order} order, ${money(s.extraMonthly)}/mo extra toward debt, living ` +
      `expenses ${money(s.livingExpenses)}/mo, saving ${money(s.monthlySavings)}/mo, ` +
      `${percent(s.realReturn)} real return, ${percent(s.withdrawalRate)} withdrawal rate` +
      (s.cardsPaidInFull ? ', cards paid in full each month' : '') +
      '.',
    `Payoff plan overrides: passive income ${s.passiveIncome == null ? 'from the Income page' : `${money(s.passiveIncome)}/mo`}, ` +
      `investments ${s.investments == null ? 'from the portfolio' : money(s.investments)}, ` +
      `retirement ${s.retirement == null ? 'from the brokerage accounts' : money(s.retirement)}` +
      (s.retirementSavings ? `, saving ${money(s.retirementSavings)}/mo for retirement` : '') +
      (s.retirementFrom ? `, retirement money counts from ${s.retirementFrom}` : '') +
      (s.stopWorking ? `, stop-working scenario from ${s.stopWorking}` : '') +
      '.',
  ];
  for (const l of s.plannedLoans) {
    lines.push(
      `Planned loan "${l.name}": ${money(l.amount)} at ${percent(l.rate)} over ${l.termMonths} ` +
        `months from ${l.start}` +
        (l.paysOff.length ? `, pays off ${l.paysOff.map(debtName).join(', ')}` : '') +
        (l.minimumOnly ? ', minimum payments only' : '') +
        '.'
    );
  }
  for (const c of s.incomeChanges) {
    lines.push(`Planned income change "${c.name}": ${money(c.monthly)}/mo from ${c.start}.`);
  }
  for (const t of s.priceTargets) {
    lines.push(`Price target: ${t.asset} at ${money(t.price)} by ${t.month}.`);
  }
  for (const x of s.sales) {
    lines.push(
      `Planned sale: ${x.units} ${x.asset} in ${x.month}, ${percent(x.taxRate)} tax` +
        (x.payTo ? `, proceeds to ${debtName(x.payTo)}` : '') +
        '.'
    );
  }
  if (s.minimumOnly.length) {
    lines.push(`Debts kept at minimum payments: ${s.minimumOnly.map(debtName).join(', ')}.`);
  }
  return lines;
}

/**
 * The plan's results as lines: the same debt-free date, financially-free date
 * and FIRE number the Debts page shows, from the same functions. Pure.
 */
export function describePlanOutlook(
  s: DebtPlanSettings,
  setup: PlanSetup,
  { result, stopResult, fire }: PlanOutlook
): string[] {
  const now = result.months[0].month;
  const age = (ym: string) =>
    s.birthMonth ? `, at age ${Math.floor(monthsBetween(s.birthMonth, ym) / 12)}` : '';
  const when = (ym: string) => `${ym} (in ${monthsBetween(now, ym)} months${age(ym)})`;
  const runEnd = s.birthMonth ? 'to age 95' : 'for 50 years';
  const living = s.livingExpenses;
  const lines: string[] = [];

  // A planned loan can bring debt back later even when nothing is owed today.
  const owesAnything = result.months.some((m) => m.totalOwed > 0.005);
  if (!owesAnything) {
    lines.push('Payoff plan projection: nothing owed now or under any planned loan.');
  } else if (result.debtFree) {
    const sooner = result.debtFreeAsScheduled
      ? monthsBetween(result.debtFree, result.debtFreeAsScheduled)
      : 0;
    const saved = result.interestAsScheduled - result.interest;
    lines.push(
      `Payoff plan projection (today's dollars, as if you keep working): debt-free ${when(result.debtFree)}` +
        (sooner > 0
          ? `, ${sooner} months sooner than paying only what's due (${result.debtFreeAsScheduled})`
          : '') +
        `. Interest left ${money(result.interest)}` +
        (saved > 1 ? `, ${money(saved)} less than paying only what's due` : '') +
        '.'
    );
  } else {
    lines.push('Payoff plan projection: not debt-free within 50 years at these numbers.');
  }

  // In the order they close, so a reader can narrate the payoff sequence.
  const closes = [...setup.debts, ...setup.loans]
    // A planned loan that never opens within the run has no paidOff entry at all.
    .filter(({ key }) => key in result.paidOff || key in result.rolledInto)
    .map(({ key, name }) => {
      const rolled = result.rolledInto[key];
      if (rolled) {
        const into = setup.loans.find((l) => l.key === rolled.into)?.name || 'a planned loan';
        return { month: rolled.month, text: `${name} rolled into ${into} ${rolled.month}` };
      }
      const paid = result.paidOff[key];
      return paid
        ? { month: paid, text: `${name} paid off ${paid}` }
        : { month: '9999-99', text: `${name} not paid off within 50 years` };
    })
    .sort((a, b) => a.month.localeCompare(b.month));
  if (closes.length) {
    lines.push(`Under the plan, in order: ${closes.map((c) => c.text).join('; ')}.`);
  }
  for (const l of setup.loans) {
    const start = result.loanStarts[l.key];
    if (start) {
      lines.push(
        `Planned loan "${l.name}" opens ${start.month} at ${money(start.balance)}, ${money(start.payment)}/mo.`
      );
    }
  }
  for (const x of s.sales) {
    const sold = result.saleResults[x.id];
    if (sold) {
      lines.push(
        `Planned sale of ${sold.units} ${x.asset} in ${sold.month}: ${money(sold.proceeds)}, ` +
          `${money(sold.tax)} to tax, ${money(sold.toDebt)} toward debt.`
      );
    }
  }
  if (result.growing.length) {
    const names = result.growing.map((k) => setup.debts.find((d) => d.key === k)?.name ?? k);
    lines.push(
      `${names.join(', ')}: the scheduled payment doesn't cover the interest, so only the ` +
        "plan's extra and rolled-over payments pay it off."
    );
  }

  const toDebt = result.months[0].needs - living + s.extraMonthly;
  lines.push(
    `Going out each month now: ${money(toDebt)} to debt` +
      (living > 0 ? ` plus ${money(living)} living expenses.` : ', before living expenses.')
  );

  if (living <= 0) {
    lines.push('Financially free: no living expenses entered, so the plan cannot say.');
  } else if (result.free === now) {
    lines.push('Financially free now: passive income already covers monthly needs.');
  } else if (result.free) {
    lines.push(
      `Financially free ${when(result.free)}: from then passive income, counting a ` +
        `${percent(s.withdrawalRate)} yearly draw on investments, covers needs for good.`
    );
  } else {
    lines.push('Financially free: not within 50 years at these numbers.');
  }

  if (fire === null) {
    lines.push('FIRE number: out of reach; at these numbers no amount of investments lasts.');
  } else if (fire === 0) {
    lines.push('FIRE number: $0; passive income alone covers needs.');
  } else {
    const share = Math.round((setup.spendableNow / fire) * 100);
    lines.push(
      `FIRE number: ${money(fire)} in spendable investments (outside retirement accounts) to ` +
        `stop working now and last ${runEnd}; there is ${money(setup.spendableNow)} now (${share}%).`
    );
  }

  if (s.stopWorking && stopResult) {
    lines.push(
      stopResult.runsOut
        ? `If you stop working ${s.stopWorking}: the money runs out ${stopResult.runsOut}${age(stopResult.runsOut)}.`
        : `If you stop working ${s.stopWorking}: the money lasts ${runEnd}` +
            (stopResult.lowest
              ? `; lowest point ${money(stopResult.lowest.amount)} to draw on, in ` +
                `${stopResult.lowest.month}${age(stopResult.lowest.month)}`
              : '') +
            '.'
    );
  }
  return lines;
}

export const payoffPlanSource: ContextSource = {
  id: 'payoff-plan',
  label: 'Payoff plan',
  group: 'money',
  description:
    'The Debts > Payoff plan: its saved inputs (payoff order, extra payment, living expenses, ' +
    'savings, return and withdrawal assumptions, planned loans, income changes, price targets, ' +
    'sales) and its projection, computed the way the Debts page computes it: debt-free date, ' +
    'the payoff month of each debt, financially-free date, FIRE number and the stop-working ' +
    'scenario.',
  files: ['.docvault-debt-plan.json'],
  async read(req) {
    const r = new ReadCollector();
    await r.part('money/payoff-plan', async () => {
      const plan = await loadDebtPlan();
      // A plan never saved is all defaults: nothing the owner chose, so nothing to report.
      if (!plan.updatedAt) return;
      if (windowTest(req)(plan.updatedAt)) {
        r.lines.push(`Payoff plan edited ${plan.updatedAt.slice(0, 10)}.`);
      }
      if (!req.full && req.purpose !== 'query') return;
      r.lines.push(...describePayoffPlan(plan));
      await r.part('money/payoff-plan-projection', async () => {
        const today = new Date(`${req.today}T12:00:00`);
        const snapshot = await financialSnapshotJson(today.getFullYear());
        const setup = buildPlan(plan, planDefaults(snapshot as PlanSnapshot), today);
        r.lines.push(...describePlanOutlook(plan, setup, planOutlook(setup, plan.stopWorking)));
      });
    });
    return r.result();
  },
};
