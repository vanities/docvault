// Extractors: Pure functions that extract structured data from a single parsed document.
// This is the ONE place that knows about field-name variants.
// All consumers (tax-summary, financial-snapshot, frontend endpoints) call these.

import type {
  IncomeItem,
  ExpenseItem,
  CapitalGainsItem,
  DepositTransaction,
  InvoiceItem,
  RetirementItem,
  ParsedData,
} from './types.js';

// --- Deposit Classification ---
// Determines whether a bank deposit is business revenue, an owner contribution, or a fee reversal.

export function isRevenueDeposit(description: string): boolean {
  return /orig co name:/i.test(description) || /co entry/i.test(description);
}

export function isFeeReversal(description: string): boolean {
  return /fee reversal/i.test(description);
}

export function isOwnerContribution(description: string): boolean {
  return (
    !isRevenueDeposit(description) &&
    !isFeeReversal(description) &&
    (/online transfer.*from/i.test(description) ||
      /transfer from/i.test(description) ||
      /mobile deposit/i.test(description))
  );
}

// --- Income Extractors ---

export function extractW2Income(parsed: ParsedData, filename: string): IncomeItem | null {
  // New-schema path: check _documentType first
  if (parsed._documentType === 'w2' || parsed.documentType === 'w2') {
    if (!parsed.wages) return null;
    return {
      source: (parsed.employerName || parsed.employer || filename) as string,
      amount: parsed.wages as number,
      type: 'W-2',
      details: {
        federalWithheld: parsed.federalWithheld ?? parsed.federalIncomeTaxWithheld ?? 0,
        stateWithheld: parsed.stateWithheld ?? parsed.stateIncomeTaxWithheld ?? 0,
        socialSecurityWages: parsed.socialSecurityWages ?? 0,
        medicareWages: parsed.medicareWages ?? 0,
        socialSecurityTax: parsed.socialSecurityTax ?? 0,
        medicareTax: parsed.medicareTax ?? 0,
      },
    };
  }
  // Legacy heuristic: if it has wages but no 1099 fields
  if (parsed.wages && !parsed.nonemployeeCompensation && !parsed.ordinaryDividends) {
    return {
      source: (parsed.employerName || parsed.employer || filename) as string,
      amount: parsed.wages as number,
      type: 'W-2',
      details: {
        federalWithheld: parsed.federalWithheld ?? parsed.federalIncomeTaxWithheld ?? 0,
        stateWithheld: parsed.stateWithheld ?? parsed.stateIncomeTaxWithheld ?? 0,
        socialSecurityWages: parsed.socialSecurityWages ?? 0,
        medicareWages: parsed.medicareWages ?? 0,
      },
    };
  }
  return null;
}

export function extract1099NECIncome(parsed: ParsedData, filename: string): IncomeItem | null {
  if (
    parsed._documentType === '1099-nec' ||
    parsed.documentType === '1099-nec' ||
    parsed.nonemployeeCompensation
  ) {
    if (!parsed.nonemployeeCompensation) return null;
    return {
      source: (parsed.payerName || parsed.payer || filename) as string,
      amount: parsed.nonemployeeCompensation as number,
      type: '1099-NEC',
      details: {
        federalWithheld: parsed.federalWithheld ?? 0,
        payerTin: parsed.payerTin,
      },
    };
  }
  return null;
}

export function extract1099DIVIncome(parsed: ParsedData, filename: string): IncomeItem | null {
  if (
    parsed._documentType === '1099-div' ||
    parsed.documentType === '1099-div' ||
    (parsed.ordinaryDividends && !parsed.div) // not a composite
  ) {
    if (!parsed.ordinaryDividends) return null;
    return {
      source: (parsed.payerName || parsed.payer || filename) as string,
      amount: parsed.ordinaryDividends as number,
      type: '1099-DIV',
      details: {
        qualifiedDividends: parsed.qualifiedDividends ?? 0,
        capitalGainDistributions: parsed.capitalGainDistributions ?? 0,
        foreignTaxPaid: parsed.foreignTaxPaid ?? 0,
        federalWithheld: parsed.federalWithheld ?? 0,
      },
    };
  }
  return null;
}

export function extract1099INTIncome(parsed: ParsedData, filename: string): IncomeItem | null {
  if (
    parsed._documentType === '1099-int' ||
    parsed.documentType === '1099-int' ||
    (parsed.interestIncome && !parsed.int) // not a composite
  ) {
    if (!parsed.interestIncome) return null;
    return {
      source: (parsed.payerName || parsed.payer || filename) as string,
      amount: parsed.interestIncome as number,
      type: '1099-INT',
      details: {
        federalWithheld: parsed.federalWithheld ?? 0,
        taxExemptInterest: parsed.taxExemptInterest ?? 0,
      },
    };
  }
  return null;
}

export function extract1099RIncome(parsed: ParsedData, filename: string): IncomeItem | null {
  if (parsed._documentType === '1099-r' || parsed.documentType === '1099-r') {
    if (!parsed.grossDistribution && !parsed.taxableAmount) return null;
    return {
      source: (parsed.payerName || parsed.payer || filename) as string,
      amount: (parsed.taxableAmount || parsed.grossDistribution || 0) as number,
      type: '1099-R',
      details: {
        grossDistribution: parsed.grossDistribution ?? 0,
        taxableAmount: parsed.taxableAmount ?? 0,
        distributionCode: parsed.distributionCode,
        federalWithheld: parsed.federalWithheld ?? 0,
      },
    };
  }
  return null;
}

export function extractK1Income(parsed: ParsedData, filename: string): IncomeItem | null {
  if (
    parsed._documentType === 'k-1' ||
    parsed.documentType === 'k-1' ||
    parsed.ordinaryIncome !== undefined ||
    parsed.guaranteedPayments !== undefined ||
    parsed.selfEmploymentEarnings !== undefined
  ) {
    const ordinaryIncome = (parsed.ordinaryIncome as number) || 0;
    const guaranteedPayments = (parsed.guaranteedPayments as number) || 0;
    const amount = ordinaryIncome + guaranteedPayments;
    if (amount === 0) return null;
    return {
      source: (parsed.entityName || filename) as string,
      amount,
      type: 'K-1',
      details: {
        ordinaryIncome,
        guaranteedPayments,
        selfEmploymentEarnings: parsed.selfEmploymentEarnings ?? 0,
        distributions: parsed.distributions ?? 0,
        formType: parsed.formType,
      },
    };
  }
  return null;
}

// --- Capital Gains Extractor ---

export function extractCapitalGains(parsed: ParsedData, filename: string): CapitalGainsItem | null {
  const docType = (parsed._documentType || parsed.documentType) as string;

  // 1099-Composite: gains are nested under b.{}
  if (docType === '1099-composite') {
    const b = parsed.b as Record<string, unknown> | undefined;
    // Also check flat fields (legacy format)
    const stGain = ((b?.shortTermGainLoss as number) || (parsed.shortTermGainLoss as number) || 0);
    const ltGain = ((b?.longTermGainLoss as number) || (parsed.longTermGainLoss as number) || 0);
    if (stGain === 0 && ltGain === 0) return null;
    return {
      source: (parsed.payer || parsed.payerName || filename) as string,
      shortTermGainLoss: stGain,
      longTermGainLoss: ltGain,
      totalGainLoss: stGain + ltGain,
      details: {
        totalProceeds: b?.totalProceeds ?? parsed.totalProceeds,
        totalCostBasis: b?.totalCostBasis ?? parsed.totalCostBasis,
        transactions: b?.transactions,
      },
    };
  }

  // 1099-B: gains are flat
  if (docType === '1099-b' || parsed.shortTermGainLoss !== undefined || parsed.longTermGainLoss !== undefined) {
    const stGain = (parsed.shortTermGainLoss as number) || 0;
    const ltGain = (parsed.longTermGainLoss as number) || 0;
    if (stGain === 0 && ltGain === 0) return null;
    return {
      source: (parsed.payerName || parsed.payer || filename) as string,
      shortTermGainLoss: stGain,
      longTermGainLoss: ltGain,
      totalGainLoss: stGain + ltGain,
    };
  }

  return null;
}

// --- Expense Extractor ---

export function extractExpense(parsed: ParsedData, filename: string): ExpenseItem | null {
  const docType = (parsed._documentType || parsed.documentType) as string;

  // Only extract from receipt-like documents
  if (
    docType === 'receipt' ||
    docType === 'invoice' ||
    (parsed.amount && (parsed.vendor || parsed.category))
  ) {
    const amount = (parsed.totalAmount || parsed.amount) as number;
    if (!amount || amount <= 0) return null;
    return {
      vendor: (parsed.vendor || 'Unknown') as string,
      amount,
      category: (parsed.category || 'other') as string,
      date: parsed.date as string | undefined,
    };
  }
  return null;
}

// --- Bank Deposit Extractors ---

// Extract the total deposits number from a bank statement (handles all field variants)
export function extractDepositTotal(parsed: ParsedData): number {
  if (Array.isArray(parsed.deposits)) {
    return (parsed.deposits as { amount?: number }[]).reduce((s, d) => s + (d.amount || 0), 0);
  }
  if (Array.isArray(parsed.depositsAndAdditions)) {
    return (parsed.depositsAndAdditions as { amount?: number }[]).reduce(
      (s, d) => s + (d.amount || 0),
      0
    );
  }
  if (Array.isArray(parsed.transactions)) {
    const txns = parsed.transactions as { amount?: number; type?: string }[];
    return txns
      .filter(
        (t) =>
          t.type === 'deposit' ||
          t.type === 'Deposit' ||
          (t.amount && t.amount > 0 && !t.type?.toLowerCase().includes('withdraw'))
      )
      .reduce((s, d) => s + (d.amount || 0), 0);
  }
  if (typeof parsed.totalDeposits === 'number') return parsed.totalDeposits;
  if (typeof parsed.totalDepositsAndAdditions === 'number') return parsed.totalDepositsAndAdditions;
  return 0;
}

// Extract individual deposit transactions from a bank statement
export function extractDepositTransactions(parsed: ParsedData): DepositTransaction[] {
  let raw: { date?: string; description?: string; amount?: number }[] = [];

  if (Array.isArray(parsed.deposits)) {
    raw = parsed.deposits as typeof raw;
  } else if (Array.isArray(parsed.depositsAndAdditions)) {
    raw = parsed.depositsAndAdditions as typeof raw;
  } else if (Array.isArray(parsed.transactions)) {
    const txns = parsed.transactions as { date?: string; description?: string; amount?: number; type?: string }[];
    raw = txns.filter(
      (t) =>
        t.type === 'deposit' ||
        t.type === 'Deposit' ||
        (t.amount && t.amount > 0 && !t.type?.toLowerCase().includes('withdraw'))
    );
  }

  return raw.map((d) => ({
    date: d.date || '',
    description: d.description || '',
    amount: d.amount || 0,
    isOwnerContribution: isOwnerContribution(d.description || ''),
    isRevenueDeposit: isRevenueDeposit(d.description || ''),
  }));
}

// --- Invoice Extractor ---

export function extractInvoice(parsed: ParsedData, filename: string): InvoiceItem | null {
  const docType = (parsed._documentType || parsed.documentType) as string;
  if (docType === 'invoice' || (parsed.amount && (parsed.customer || parsed.vendor))) {
    return {
      customer: (parsed.customer || parsed.vendor || parsed.clientName || 'Unknown') as string,
      amount: (parsed.totalAmount || parsed.amount || 0) as number,
      date: parsed.date as string | undefined,
      invoiceNumber: parsed.invoiceNumber as string | undefined,
    };
  }
  return null;
}

// --- Retirement Extractor ---

export function extractRetirement(parsed: ParsedData, filename: string): RetirementItem | null {
  const docType = (parsed._documentType || parsed.documentType) as string;
  if (
    docType === 'retirement-statement' ||
    parsed.employerContributions !== undefined ||
    parsed.employeeContributions !== undefined ||
    parsed.totalContributions !== undefined
  ) {
    return {
      institution: (parsed.institution || filename) as string,
      accountType: (parsed.accountType || 'Unknown') as string,
      employerContributions: (parsed.employerContributions || 0) as number,
      employeeContributions: (parsed.employeeContributions || 0) as number,
      totalContributions: (parsed.totalContributions || 0) as number,
    };
  }
  return null;
}

// --- Master Extractor ---
// Tries all income extractors in order. Returns the first match.
// This avoids double-counting (e.g., a doc with both wages and nonemployeeCompensation).

export function extractAllIncome(parsed: ParsedData, filename: string): IncomeItem[] {
  const items: IncomeItem[] = [];

  const w2 = extractW2Income(parsed, filename);
  if (w2) { items.push(w2); return items; } // W-2 is exclusive

  const nec = extract1099NECIncome(parsed, filename);
  if (nec) items.push(nec);

  const div = extract1099DIVIncome(parsed, filename);
  if (div) items.push(div);

  const int = extract1099INTIncome(parsed, filename);
  if (int) items.push(int);

  const r = extract1099RIncome(parsed, filename);
  if (r) items.push(r);

  const k1 = extractK1Income(parsed, filename);
  if (k1) items.push(k1);

  // Capital gains are tracked separately but may also produce income items
  const gains = extractCapitalGains(parsed, filename);
  if (gains) {
    items.push({
      source: gains.source,
      amount: gains.totalGainLoss,
      type: '1099-B',
      details: {
        shortTermGainLoss: gains.shortTermGainLoss,
        longTermGainLoss: gains.longTermGainLoss,
      },
    });
  }

  // For composites: also extract DIV/INT from sub-sections
  const docType = (parsed._documentType || parsed.documentType) as string;
  if (docType === '1099-composite') {
    const divSection = parsed.div as Record<string, unknown> | undefined;
    if (divSection?.ordinaryDividends) {
      items.push({
        source: (parsed.payer || parsed.payerName || filename) as string,
        amount: divSection.ordinaryDividends as number,
        type: '1099-DIV',
        details: {
          qualifiedDividends: divSection.qualifiedDividends ?? 0,
          capitalGainDistributions: divSection.capitalGainDistributions ?? 0,
          foreignTaxPaid: divSection.foreignTaxPaid ?? 0,
          federalWithheld: divSection.federalWithheld ?? 0,
        },
      });
    }
    const intSection = parsed.int as Record<string, unknown> | undefined;
    if (intSection?.interestIncome) {
      items.push({
        source: (parsed.payer || parsed.payerName || filename) as string,
        amount: intSection.interestIncome as number,
        type: '1099-INT',
        details: {
          federalWithheld: intSection.federalWithheld ?? 0,
          taxExemptInterest: intSection.taxExemptInterest ?? 0,
        },
      });
    }
  }

  return items;
}
