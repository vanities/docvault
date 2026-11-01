import { loadDebtPlan } from '../../data.js';
import type { DebtPlanSettings } from '../../debt-plan.js';
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

export const payoffPlanSource: ContextSource = {
  id: 'payoff-plan',
  label: 'Payoff plan',
  group: 'money',
  description:
    'The saved Debts > Payoff plan inputs: payoff order, extra payment, living expenses, ' +
    'savings, return and withdrawal assumptions, planned loans, income changes, price targets ' +
    'and sales. The projection (debt-free date, FIRE number) is computed on the Debts page.',
  files: ['.docvault-debt-plan.json'],
  async read(req) {
    const r = new ReadCollector();
    await r.part('money/payoff-plan', async () => {
      const plan = await loadDebtPlan();
      if (plan.updatedAt && windowTest(req)(plan.updatedAt)) {
        r.lines.push(`Payoff plan edited ${plan.updatedAt.slice(0, 10)}.`);
      }
      // A plan never saved is all defaults: nothing the owner chose, so nothing to report.
      if (!plan.updatedAt) return;
      if (req.full || req.purpose === 'query') r.lines.push(...describePayoffPlan(plan));
    });
    return r.result();
  },
};
