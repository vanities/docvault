// Bank deposit aggregation — builds monthly/quarterly deposit summaries
// with revenue vs owner contribution classification.

import type { MonthlyDeposits, QuarterlyDeposits, Form2210Period, ParsedData, DocumentMetadata } from './types.js';
import { extractDepositTotal, extractDepositTransactions, isOwnerContribution } from './extractors.js';

export interface BankDepositSummaryResult {
  totalDeposits: number;
  totalRevenue: number;
  totalOwnerContributions: number;
  statementCount: number;
  monthly: MonthlyDeposits[];
  quarterly: QuarterlyDeposits[];
  form2210Periods: Form2210Period[];
}

export function getBankDepositSummary(
  entityId: string,
  year: string,
  parsedDataMap: Record<string, ParsedData>,
  metadataMap: Record<string, DocumentMetadata>,
  statementFiles: string[] // sorted list of statement filenames
): BankDepositSummaryResult {
  const monthly: MonthlyDeposits[] = [];

  for (const file of statementFiles.sort()) {
    const monthMatch = file.match(/(\d{4})-(\d{2})/);
    if (!monthMatch) continue;

    const parsedKey = `${entityId}/${year}/statements/bank/${file}`;
    const parsed = parsedDataMap[parsedKey];
    const meta = metadataMap[parsedKey];

    if (!parsed) {
      monthly.push({
        month: `${monthMatch[1]}-${monthMatch[2]}`,
        deposits: 0,
        ownerContributions: 0,
        revenueDeposits: 0,
        sources: [],
      });
      continue;
    }

    const depositTotal = extractDepositTotal(parsed);
    const sources = extractDepositTransactions(parsed);

    const ownerContribs = sources
      .filter((d) => d.isOwnerContribution)
      .reduce((s, d) => s + d.amount, 0);

    monthly.push({
      month: `${monthMatch[1]}-${monthMatch[2]}`,
      deposits: depositTotal,
      ownerContributions: ownerContribs,
      revenueDeposits: depositTotal - ownerContribs,
      sources,
      notes: meta?.notes,
    });
  }

  // Build quarterly summaries
  const quarterly: QuarterlyDeposits[] = [
    { quarter: 'Q1', deposits: 0, revenueDeposits: 0, ownerContributions: 0 },
    { quarter: 'Q2', deposits: 0, revenueDeposits: 0, ownerContributions: 0 },
    { quarter: 'Q3', deposits: 0, revenueDeposits: 0, ownerContributions: 0 },
    { quarter: 'Q4', deposits: 0, revenueDeposits: 0, ownerContributions: 0 },
  ];

  for (const m of monthly) {
    const monthNum = parseInt(m.month.split('-')[1], 10);
    const qIdx = Math.floor((monthNum - 1) / 3);
    if (qIdx >= 0 && qIdx < 4) {
      quarterly[qIdx].deposits += m.deposits;
      quarterly[qIdx].revenueDeposits += m.revenueDeposits;
      quarterly[qIdx].ownerContributions += m.ownerContributions;
    }
  }

  // Build Form 2210 annualized income periods (cumulative through cutoff)
  const form2210Cutoffs = [
    { label: '1/1–3/31', endMonth: 3 },
    { label: '1/1–5/31', endMonth: 5 },
    { label: '1/1–8/31', endMonth: 8 },
    { label: '1/1–12/31', endMonth: 12 },
  ];

  const form2210Periods = form2210Cutoffs.map(({ label, endMonth }) => {
    let cumDeposits = 0,
      cumRevenue = 0,
      cumOwner = 0;
    for (const m of monthly) {
      const monthNum = parseInt(m.month.split('-')[1], 10);
      if (monthNum <= endMonth) {
        cumDeposits += m.deposits;
        cumRevenue += m.revenueDeposits;
        cumOwner += m.ownerContributions;
      }
    }
    return {
      label,
      cumulativeDeposits: cumDeposits,
      cumulativeRevenue: cumRevenue,
      cumulativeOwnerContributions: cumOwner,
    };
  });

  const totalDeposits = monthly.reduce((s, m) => s + m.deposits, 0);
  const totalRevenue = monthly.reduce((s, m) => s + m.revenueDeposits, 0);
  const totalOwnerContributions = monthly.reduce((s, m) => s + m.ownerContributions, 0);

  return {
    totalDeposits,
    totalRevenue,
    totalOwnerContributions,
    statementCount: monthly.filter((m) => m.deposits > 0 || m.sources.length > 0).length,
    monthly,
    quarterly,
    form2210Periods,
  };
}
