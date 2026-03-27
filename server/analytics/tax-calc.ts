// Tax calculation — income aggregation, SE tax, AGI estimate, bracket calc, NIIT,
// standard deduction, and estimated quarterly payments.

import type { TaxCalculation, IncomeItem } from './types.js';

interface EntityIncome {
  income: IncomeItem[];
}

// ---------------------------------------------------------------------------
// MFJ tax bracket tables
// ---------------------------------------------------------------------------

interface Bracket {
  limit: number;
  rate: number;
}

const MFJ_BRACKETS: Record<string, Bracket[]> = {
  '2024': [
    { limit: 23200, rate: 0.1 },
    { limit: 94300, rate: 0.12 },
    { limit: 201050, rate: 0.22 },
    { limit: 383900, rate: 0.24 },
    { limit: 487450, rate: 0.32 },
    { limit: 731200, rate: 0.35 },
    { limit: Infinity, rate: 0.37 },
  ],
  '2025': [
    { limit: 23850, rate: 0.1 },
    { limit: 96950, rate: 0.12 },
    { limit: 206700, rate: 0.22 },
    { limit: 394600, rate: 0.24 },
    { limit: 501050, rate: 0.32 },
    { limit: 751600, rate: 0.35 },
    { limit: Infinity, rate: 0.37 },
  ],
  '2026': [
    { limit: 24300, rate: 0.1 },
    { limit: 98800, rate: 0.12 },
    { limit: 210650, rate: 0.22 },
    { limit: 401800, rate: 0.24 },
    { limit: 510200, rate: 0.32 },
    { limit: 765600, rate: 0.35 },
    { limit: Infinity, rate: 0.37 },
  ],
};

// MFJ standard deduction by year
const STANDARD_DEDUCTION_MFJ: Record<string, number> = {
  '2023': 27700,
  '2024': 29200,
  '2025': 31500,
  '2026': 32300,
};

// NIIT threshold for MFJ
const NIIT_THRESHOLD_MFJ = 250000;
const NIIT_RATE = 0.038;

// 1099-R distribution codes that are typically taxable pension/annuity
const PENSION_CODES = new Set(['1', '2', '3', '4', '7', 'D']);
// 1099-R distribution codes for IRA distributions
const IRA_CODES = new Set(['G', 'H']); // G = rollover (usually non-taxable), H = direct rollover

function calculateIncomeTax(taxableIncome: number, year: string): number {
  const brackets = MFJ_BRACKETS[year] || MFJ_BRACKETS['2025'];
  if (taxableIncome <= 0) return 0;

  let tax = 0;
  let prevLimit = 0;
  for (const bracket of brackets) {
    const taxableInBracket = Math.min(taxableIncome, bracket.limit) - prevLimit;
    if (taxableInBracket <= 0) break;
    tax += taxableInBracket * bracket.rate;
    prevLimit = bracket.limit;
  }
  return Math.round(tax);
}

// ---------------------------------------------------------------------------
// Main calculation
// ---------------------------------------------------------------------------

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
  let totalInterestIncome = 0;
  let totalTaxablePension = 0;
  let totalTaxableIRA = 0;
  let totalK1Income = 0;
  let totalMiscIncome = 0;
  let totalStakingIncome = 0;
  let cryptoCapGainsST = 0;
  let cryptoCapGainsLT = 0;
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
          totalFederalWithheld += (inc.details?.federalWithheld as number) || 0;
          break;
        case '1099-INT':
          totalInterestIncome += inc.amount;
          totalFederalWithheld += (inc.details?.federalWithheld as number) || 0;
          break;
        case '1099-R': {
          const code = String(inc.details?.distributionCode || '7');
          const taxable = (inc.details?.taxableAmount as number) ?? inc.amount;
          totalFederalWithheld += (inc.details?.federalWithheld as number) || 0;
          if (IRA_CODES.has(code)) {
            // Rollovers — generally not taxable (taxableAmount should be 0)
            totalTaxableIRA += taxable;
          } else if (PENSION_CODES.has(code)) {
            totalTaxablePension += taxable;
          } else {
            // Unknown code — treat as pension
            totalTaxablePension += taxable;
          }
          break;
        }
        case '1099-MISC':
          totalMiscIncome += inc.amount;
          break;
        case 'K-1':
          totalK1Income += inc.amount;
          break;
        case 'other':
          // Check for koinly/staking income
          if (inc.details?.stakingIncome) {
            totalStakingIncome += (inc.details.stakingIncome as number) || 0;
          } else if (inc.details?.cryptoShortTerm !== undefined) {
            cryptoCapGainsST += (inc.details.cryptoShortTerm as number) || 0;
            cryptoCapGainsLT += (inc.details.cryptoLongTerm as number) || 0;
          } else {
            totalOtherIncome += inc.amount;
          }
          break;
      }
    }
  }

  // SE tax estimate (Schedule C × 0.9235 × 15.3%)
  const netSEEarnings = totalScheduleC * 0.9235;
  const seTaxEstimate = netSEEarnings * 0.153;
  const seTaxDeduction = seTaxEstimate / 2;

  const totalCapGains = totalCapGainsST + totalCapGainsLT;
  const cryptoCapGainsTotal = cryptoCapGainsST + cryptoCapGainsLT;

  const estimatedTotalIncome =
    totalWages +
    totalScheduleC +
    totalCapGains +
    cryptoCapGainsTotal +
    totalOrdinaryDividends +
    totalInterestIncome +
    totalTaxablePension +
    totalTaxableIRA +
    totalK1Income +
    totalMiscIncome +
    totalStakingIncome +
    totalOtherIncome;

  const estimatedAdjustments = seTaxDeduction + retirementDeduction;
  const estimatedAGI = estimatedTotalIncome - estimatedAdjustments;

  // Standard deduction
  const standardDeduction = STANDARD_DEDUCTION_MFJ[year] || STANDARD_DEDUCTION_MFJ['2025'];
  const estimatedTaxableIncome = Math.max(0, estimatedAGI - standardDeduction);

  // Income tax from brackets (simplified — doesn't account for QDCG worksheet)
  const estimatedIncomeTax = calculateIncomeTax(estimatedTaxableIncome, year);

  // NIIT: 3.8% on lesser of net investment income or (AGI - $250K)
  const netInvestmentIncome =
    totalCapGains + cryptoCapGainsTotal + totalOrdinaryDividends + totalInterestIncome;
  const agiExcess = Math.max(0, estimatedAGI - NIIT_THRESHOLD_MFJ);
  const niit = Math.round(Math.min(netInvestmentIncome, agiExcess) * NIIT_RATE);

  const estimatedTotalTax = estimatedIncomeTax + Math.round(seTaxEstimate) + niit;

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
    // Extended fields
    interestIncome: totalInterestIncome,
    taxablePension: totalTaxablePension,
    taxableIRA: totalTaxableIRA,
    k1Income: totalK1Income,
    miscIncome: totalMiscIncome,
    stakingIncome: totalStakingIncome,
    cryptoCapitalGains: {
      shortTerm: cryptoCapGainsST,
      longTerm: cryptoCapGainsLT,
      total: cryptoCapGainsTotal,
    },
    standardDeduction,
    estimatedTaxableIncome,
    estimatedIncomeTax,
    niit,
    estimatedTotalTax,
  };
}
