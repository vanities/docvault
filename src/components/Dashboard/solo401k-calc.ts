// IRS Pub 560 Deduction Worksheet for Self-Employed — pure computation.
// Used by Solo401kCalculator component and tested directly.

// IRS limits by year
export const EMPLOYEE_LIMIT: Record<number, number> = {
  2024: 23000,
  2025: 23500,
  2026: 23500,
};
export const COMBINED_CAP: Record<number, number> = {
  2024: 69000,
  2025: 70000,
  2026: 70000,
};

export function computeSolo401k(
  gross: number,
  expenses: number,
  k1SEEarnings: number,
  taxYear: number
) {
  const employeeLimit = EMPLOYEE_LIMIT[taxYear] ?? 23500;
  const combinedCap = COMBINED_CAP[taxYear] ?? 70000;

  const netProfit = Math.max(0, gross - expenses);

  // Step 1: combine all SE income
  const combinedSEIncome = netProfit + k1SEEarnings;

  // SE tax with intermediate rounding to match IRS worksheet
  const seTaxBase = Math.round(Math.max(0, combinedSEIncome) * 0.9235);
  const seTax = Math.round(seTaxBase * 0.153);
  const halfSeTax = Math.round(seTax / 2);

  // Step 3: net earnings
  const netEarnings = Math.max(0, combinedSEIncome - halfSeTax);

  // Step 5: employer at reduced rate
  const employerContrib = Math.round(netEarnings * 0.2);

  const rawTotal = employerContrib + employeeLimit;
  const totalContrib = Math.min(rawTotal, combinedCap);
  const actualEmployer = Math.min(employerContrib, combinedCap - employeeLimit);
  const remainingCapacity = Math.max(0, combinedCap - totalContrib);

  return {
    gross,
    expenses,
    netProfit,
    k1SEEarnings,
    combinedSEIncome,
    seTax,
    halfSeTax,
    netEarnings,
    employerContrib: actualEmployer,
    employeeLimit,
    combinedCap,
    totalContrib,
    remainingCapacity,
  };
}
