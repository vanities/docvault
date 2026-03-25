// Tax calculation — SE tax, AGI estimate, estimated quarterly payments.
// Extracted from financial-snapshot L3278-3364.

import type { TaxCalculation, IncomeItem } from './types.js';

interface EntityIncome {
  income: IncomeItem[];
}

export function getTaxCalculation(
  year: string,
  entitySummaries: Record<string, EntityIncome>,
  retirementDeduction: number
): TaxCalculation {
  let totalWages = 0;
  let totalFederalWithheld = 0;
  let totalScheduleC = 0;
  let totalCapGainsST = 0;
  let totalCapGainsLT = 0;
  let totalOrdinaryDividends = 0;
  let totalQualifiedDividends = 0;
  let totalOtherIncome = 0;
  const w2Details: { employer: string; wages: number; withheld: number }[] = [];

  for (const [, data] of Object.entries(entitySummaries)) {
    for (const inc of data.income) {
      switch (inc.type) {
        case 'W-2':
          totalWages += inc.amount;
          totalFederalWithheld += (inc.details?.federalWithheld as number) || 0;
          w2Details.push({
            employer: inc.source,
            wages: inc.amount,
            withheld: (inc.details?.federalWithheld as number) || 0,
          });
          break;
        case '1099-NEC':
          totalScheduleC += inc.amount;
          break;
        case '1099-B':
          totalCapGainsST += (inc.details?.shortTermGainLoss as number) || 0;
          totalCapGainsLT += (inc.details?.longTermGainLoss as number) || 0;
          break;
        case '1099-DIV':
          totalOrdinaryDividends += inc.amount;
          totalQualifiedDividends += (inc.details?.qualifiedDividends as number) || 0;
          break;
        case 'K-1':
          totalOtherIncome += inc.amount;
          break;
      }
    }
  }

  // SE tax estimate (Schedule C × 0.9235 × 15.3%)
  const netSEEarnings = totalScheduleC * 0.9235;
  const seTaxEstimate = netSEEarnings * 0.153;
  const seTaxDeduction = seTaxEstimate / 2;

  const totalCapGains = totalCapGainsST + totalCapGainsLT;
  const estimatedTotalIncome =
    totalWages + totalScheduleC + totalCapGains + totalOrdinaryDividends + totalOtherIncome;
  const estimatedAdjustments = seTaxDeduction + retirementDeduction;
  const estimatedAGI = estimatedTotalIncome - estimatedAdjustments;

  // Estimated quarterly payments (110% safe harbor if AGI > $150K)
  const nextYear = parseInt(year) + 1;

  return {
    wages: totalWages,
    federalWithheld: totalFederalWithheld,
    w2Details,
    scheduleCIncome: totalScheduleC,
    capitalGains: {
      shortTerm: totalCapGainsST,
      longTerm: totalCapGainsLT,
      total: totalCapGains,
    },
    dividends: {
      ordinary: totalOrdinaryDividends,
      qualified: totalQualifiedDividends,
    },
    otherIncome: totalOtherIncome,
    estimatedTotalIncome,
    seTax: Math.round(seTaxEstimate),
    seTaxDeduction: Math.round(seTaxDeduction),
    retirementDeduction,
    estimatedAdjustments: Math.round(estimatedAdjustments),
    estimatedAGI: Math.round(estimatedAGI),
    estimatedPayments: {
      note: `110% safe harbor (AGI ${estimatedAGI > 150000 ? '>' : '<='} $150K)`,
      quarterly: [
        { label: 'Q1', due: `${nextYear}-04-15` },
        { label: 'Q2', due: `${nextYear}-06-15` },
        { label: 'Q3', due: `${nextYear}-09-15` },
        { label: 'Q4', due: `${nextYear + 1}-01-15` },
      ],
    },
  };
}
