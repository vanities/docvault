import { loadSnapshots, type PortfolioSnapshot } from '../../data.js';
import { readEventSource } from '../events.js';
import { money, signedMoney } from '../format.js';
import type { ContextEvent, ContextSource, ContextWindow } from '../types.js';

/** Monthly principal on the owner's mortgages lands below this on the 1st. */
const AMORTIZATION_CEILING = 5000;
const MIN_CHANGE = 1000;

/**
 * Day-over-day jumps in property equity, from the daily portfolio history,
 * which reaches back much further than debt-balance history. A loan balance
 * lowered by hand shows up here on the day it was edited: the 2026-11-01
 * test edition, lacking this, told the owner to record a paydown they had
 * already recorded days before the payment cleared. Pure.
 */
export function equityEvents(
  snapshots: PortfolioSnapshot[],
  window: ContextWindow
): ContextEvent[] {
  const days = snapshots
    .filter((s) => typeof s.propertyValue === 'number')
    .sort((a, b) => a.date.localeCompare(b.date));
  const events: ContextEvent[] = [];
  for (let i = 1; i < days.length; i++) {
    const prev = days[i - 1];
    const cur = days[i];
    if (cur.date < window.from || cur.date > window.to) continue;
    const delta = (cur.propertyValue as number) - (prev.propertyValue as number);
    if (Math.abs(delta) < MIN_CHANGE) continue;
    const why =
      cur.date.endsWith('-01') && delta > 0 && delta < AMORTIZATION_CEILING
        ? 'the monthly principal amortization'
        : 'a mortgage balance or a property value was changed by hand that day';
    events.push({
      date: cur.date,
      text: `${signedMoney(delta)} (${money(prev.propertyValue as number)} to ${money(cur.propertyValue as number)}), ${why}`,
      amount: delta,
    });
  }
  return events;
}

export const propertyEquitySource: ContextSource = {
  id: 'property-equity',
  label: 'Property equity',
  group: 'money',
  description:
    'Day-over-day jumps in total property equity from the daily portfolio history: a jump on ' +
    'most days means a mortgage balance or property value was edited by hand (a paydown, a ' +
    'refinance, a new appraisal); a small rise on the 1st is the monthly principal amortization.',
  files: ['.docvault-portfolio-snapshots-*.json'],
  read: (req) => readEventSource(propertyEquitySource, req),
  async events(window) {
    return equityEvents(await loadSnapshots(), window);
  },
};
