// Types for parsed data - used by AI parser

export interface ParsedW2 {
  documentType: 'w2';
  // Employer info
  employerName?: string;
  employer?: string; // Alias for backwards compatibility
  employerAddress?: string;
  employerCity?: string;
  employerState?: string;
  employerZip?: string;
  employerPhone?: string;
  ein?: string;
  // Employee info
  employeeName?: string;
  employeeSsn?: string;
  employeeAddress?: string;
  // Box values
  wages?: number;
  federalWithheld?: number;
  socialSecurityWages?: number;
  socialSecurityTax?: number;
  medicareWages?: number;
  medicareTax?: number;
  socialSecurityTips?: number;
  allocatedTips?: number;
  dependentCareBenefits?: number;
  nonqualifiedPlans?: number;
  box12?: Array<{ code: string; amount: number }>;
  statutoryEmployee?: boolean;
  retirementPlan?: boolean;
  thirdPartySickPay?: boolean;
  other?: string;
  stateEmployerId?: string;
  stateWages?: number;
  stateWithheld?: number;
  state?: string;
  localWages?: number;
  localWithheld?: number;
  localityName?: string;
  taxYear?: number;
}

export interface Parsed1099NEC {
  documentType: '1099-nec';
  // Payer info
  payerName?: string;
  payer?: string; // Alias
  payerAddress?: string;
  payerCity?: string;
  payerState?: string;
  payerZip?: string;
  payerCountry?: string;
  payerPhone?: string;
  payerTin?: string;
  // Recipient info
  recipientName?: string;
  recipientTin?: string;
  recipientAddress?: string;
  accountNumber?: string;
  // Box values
  nonemployeeCompensation?: number;
  payerMadeDirectSales?: boolean;
  federalWithheld?: number;
  stateTaxWithheld?: number;
  statePayerStateNo?: string;
  stateIncome?: number;
  taxYear?: number;
}

export interface Parsed1099MISC {
  documentType: '1099-misc';
  payerName?: string;
  payer?: string;
  payerAddress?: string;
  payerTin?: string;
  recipientName?: string;
  recipientTin?: string;
  accountNumber?: string;
  rents?: number;
  royalties?: number;
  otherIncome?: number;
  federalWithheld?: number;
  fishingBoatProceeds?: number;
  medicalPayments?: number;
  substitutePayments?: number;
  cropInsurance?: number;
  grossProceeds?: number;
  fishPurchased?: number;
  section409ADeferrals?: number;
  goldenParachute?: number;
  nonqualifiedDeferred?: number;
  stateTaxWithheld?: number;
  stateIncome?: number;
  taxYear?: number;
}

export interface Parsed1099DIV {
  documentType: '1099-div';
  payerName?: string;
  payer?: string;
  payerTin?: string;
  recipientName?: string;
  recipientTin?: string;
  accountNumber?: string;
  ordinaryDividends?: number;
  qualifiedDividends?: number;
  capitalGainDistributions?: number;
  unrecaptured1250Gain?: number;
  section1202Gain?: number;
  collectiblesGain?: number;
  section897Dividends?: number;
  section897CapitalGain?: number;
  nondividendDistributions?: number;
  federalWithheld?: number;
  section199ADividends?: number;
  investmentExpenses?: number;
  foreignTaxPaid?: number;
  foreignCountry?: string;
  cashLiquidation?: number;
  noncashLiquidation?: number;
  exemptInterestDividends?: number;
  privateActivityBondDividends?: number;
  stateTaxWithheld?: number;
  stateIncome?: number;
  taxYear?: number;
}

export interface Parsed1099INT {
  documentType: '1099-int';
  payerName?: string;
  payer?: string;
  payerTin?: string;
  recipientName?: string;
  recipientTin?: string;
  accountNumber?: string;
  interestIncome?: number;
  earlyWithdrawalPenalty?: number;
  interestOnSavingsBonds?: number;
  federalWithheld?: number;
  investmentExpenses?: number;
  foreignTaxPaid?: number;
  foreignCountry?: string;
  taxExemptInterest?: number;
  privateActivityBondInterest?: number;
  marketDiscount?: number;
  bondPremium?: number;
  bondPremiumTreasury?: number;
  bondPremiumTaxExempt?: number;
  taxExemptCusip?: string;
  stateTaxWithheld?: number;
  stateIncome?: number;
  taxYear?: number;
}

export interface ParsedReceipt {
  documentType: 'receipt';
  vendor?: string;
  vendorAddress?: string;
  amount?: number;
  subtotal?: number;
  tax?: number;
  date?: string;
  paymentMethod?: string;
  lastFourCard?: string;
  items?: Array<{ description: string; quantity?: number; price: number }>;
  category?: string;
}

export type ParsedTaxDocument =
  | ParsedW2
  | Parsed1099NEC
  | Parsed1099MISC
  | Parsed1099DIV
  | Parsed1099INT
  | ParsedReceipt;
