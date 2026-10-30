// One conversion from an income source's amount and frequency to a monthly
// figure. The Income page, the financial snapshot, and the Debts page's payoff
// plan all show monthly income, so they share this instead of each keeping a
// switch. Pure, so the browser imports it too.

export function toMonthly(amount: number, frequency: string): number {
  switch (frequency) {
    case 'weekly':
      return (amount * 52) / 12;
    case 'biweekly':
      return (amount * 26) / 12;
    case 'quarterly':
      return amount / 3;
    case 'annually':
      return amount / 12;
    default:
      return amount;
  }
}
