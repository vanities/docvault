// Canonical TypeScript interfaces for parser outputs.
// These are the source of truth for what each type-specific parser returns.
// The existing types in pdf.ts and src/types/index.ts remain for backward compat.

// All parsers include these metadata fields
export interface ParserMetadata {
  _documentType: string;
  _parserVersion: number;
  _parsedWith: string; // parser name that produced this result (e.g., "w2", "generic")
  _detectedType?: string; // type detected before parsing
}

// --- W-2 ---
export interface ParsedW2Schema extends ParserMetadata {
  _documentType: 'w2';
  employerName?: string;
  employerAddress?: string;
  employerCity?: string;
  employerState?: string;
  employerZip?: string;
  employerPhone?: string;
  ein?: string;
  employeeName?: string;
  employeeSsn?: string;
  employeeAddress?: string;
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
  localWages?: number;
  localWithheld?: number;
  localityName?: string;
  taxYear?: number;
}

// --- 1099-NEC ---
export interface Parsed1099NECSchema extends ParserMetadata {
  _documentType: '1099-nec';
  payerName?: string;
  payerAddress?: string;
  payerCity?: string;
  payerState?: string;
  payerZip?: string;
  payerCountry?: string;
  payerPhone?: string;
  payerTin?: string;
  recipientName?: string;
  recipientTin?: string;
  recipientAddress?: string;
  accountNumber?: string;
  nonemployeeCompensation?: number;
  payerMadeDirectSales?: boolean;
  federalWithheld?: number;
  stateTaxWithheld?: number;
  statePayerStateNo?: string;
  stateIncome?: number;
  taxYear?: number;
}

// --- 1099-DIV ---
export interface Parsed1099DIVSchema extends ParserMetadata {
  _documentType: '1099-div';
  payerName?: string;
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

// --- 1099-INT ---
export interface Parsed1099INTSchema extends ParserMetadata {
  _documentType: '1099-int';
  payerName?: string;
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

// --- 1099-B ---
export interface Parsed1099BSchema extends ParserMetadata {
  _documentType: '1099-b';
  payerName?: string;
  payerTin?: string;
  recipientName?: string;
  recipientTin?: string;
  accountNumber?: string;
  shortTermProceeds?: number;
  shortTermCostBasis?: number;
  shortTermGainLoss?: number;
  longTermProceeds?: number;
  longTermCostBasis?: number;
  longTermGainLoss?: number;
  totalProceeds?: number;
  totalCostBasis?: number;
  totalGainLoss?: number;
  federalWithheld?: number;
  taxYear?: number;
}

// --- 1099-MISC ---
export interface Parsed1099MISCSchema extends ParserMetadata {
  _documentType: '1099-misc';
  payerName?: string;
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

// --- 1099-R ---
export interface Parsed1099RSchema extends ParserMetadata {
  _documentType: '1099-r';
  payerName?: string;
  payerTin?: string;
  recipientName?: string;
  recipientTin?: string;
  accountNumber?: string;
  grossDistribution?: number;
  taxableAmount?: number;
  taxableAmountNotDetermined?: boolean;
  totalDistribution?: boolean;
  capitalGain?: number;
  federalWithheld?: number;
  distributionCode?: string;
  otherAmount?: number;
  otherPercentage?: number;
  employeeContributions?: number;
  netUnrealizedAppreciation?: number;
  stateTaxWithheld?: number;
  stateIncome?: number;
  localTaxWithheld?: number;
  localIncome?: number;
  taxYear?: number;
}

// --- 1099-Composite ---
export interface Parsed1099CompositeSchema extends ParserMetadata {
  _documentType: '1099-composite';
  payer?: string;
  payerTin?: string;
  accountNumber?: string;
  div?: {
    ordinaryDividends?: number;
    qualifiedDividends?: number;
    capitalGainDistributions?: number;
    section199ADividends?: number;
    foreignTaxPaid?: number;
    nondividendDistributions?: number;
    federalWithheld?: number;
  };
  int?: {
    interestIncome?: number;
    federalWithheld?: number;
    taxExemptInterest?: number;
  };
  b?: {
    shortTermProceeds?: number;
    shortTermCostBasis?: number;
    shortTermGainLoss?: number;
    longTermProceeds?: number;
    longTermCostBasis?: number;
    longTermGainLoss?: number;
    totalProceeds?: number;
    totalCostBasis?: number;
    totalGainLoss?: number;
    federalWithheld?: number;
  };
  misc?: {
    rents?: number;
    royalties?: number;
    otherIncome?: number;
    federalWithheld?: number;
  };
  totalDividendIncome?: number;
  totalInterestIncome?: number;
  totalCapitalGains?: number;
  totalFederalWithheld?: number;
  taxYear?: number;
}

// --- 1098 ---
export interface Parsed1098Schema extends ParserMetadata {
  _documentType: '1098';
  lender?: string;
  lenderTin?: string;
  loanNumber?: string;
  borrowerName?: string;
  borrowerTin?: string;
  borrowerAddress?: string;
  mortgageInterest?: number;
  outstandingPrincipal?: number;
  mortgageOriginationDate?: string;
  refundOfOverpaidInterest?: number;
  mortgageInsurancePremiums?: number;
  pointsPaid?: number;
  propertyAddress?: string;
  propertyTax?: number;
  // 1098-E
  studentLoanInterest?: number;
  // 1098-T
  tuitionPayments?: number;
  scholarshipsGrants?: number;
  formVariant?: string;
  taxYear?: number;
}

// --- K-1 ---
export interface ParsedK1Schema extends ParserMetadata {
  _documentType: 'k-1';
  entityName?: string;
  entityEin?: string;
  formType?: 'partnership' | 's-corp' | 'trust';
  partnerName?: string;
  partnerTin?: string;
  partnerAddress?: string;
  ordinaryIncome?: number;
  rentalIncome?: number;
  otherRentalIncome?: number;
  guaranteedPayments?: number;
  interestIncome?: number;
  dividends?: number;
  royalties?: number;
  shortTermCapitalGain?: number;
  longTermCapitalGain?: number;
  section1231Gain?: number;
  otherIncome?: number;
  section179Deduction?: number;
  otherDeductions?: number;
  selfEmploymentEarnings?: number;
  credits?: number;
  foreignTransactions?: number;
  altMinTaxItems?: number;
  taxExemptIncome?: number;
  distributions?: number;
  otherInfo?: string;
  taxYear?: number;
}

// --- Receipt ---
export interface ParsedReceiptSchema extends ParserMetadata {
  _documentType: 'receipt';
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
  // For payment histories / transaction lists
  transactions?: Array<{ amount: number; date: string; description: string }>;
  totalAmount?: number;
  transactionCount?: number;
  startDate?: string;
  endDate?: string;
}

// --- Bank Statement ---
export interface ParsedBankStatementSchema extends ParserMetadata {
  _documentType: 'bank-statement';
  bankName?: string;
  accountType?: string;
  accountNumberLast4?: string;
  statementPeriod?: { start: string; end: string };
  beginningBalance?: number;
  endingBalance?: number;
  totalDeposits?: number;
  totalWithdrawals?: number;
  deposits?: Array<{ date: string; description: string; amount: number }>;
  withdrawals?: Array<{ date: string; description: string; amount: number }>;
}

// --- Credit Card Statement ---
export interface ParsedCreditCardSchema extends ParserMetadata {
  _documentType: 'credit-card-statement';
  institution?: string;
  accountNumber?: string;
  newBalance?: number;
  previousBalance?: number;
  payments?: number;
  purchases?: number;
  creditLimit?: number;
  paymentDueDate?: string;
  statementDate?: string;
  statementPeriod?: string;
}

// --- Retirement Statement ---
export interface ParsedRetirementSchema extends ParserMetadata {
  _documentType: 'retirement-statement';
  institution?: string;
  accountType?: string;
  accountNumber?: string;
  employerContributions?: number;
  employeeContributions?: number;
  totalContributions?: number;
  taxYear?: number;
}

// --- Schedule C ---
export interface ParsedScheduleCSchema extends ParserMetadata {
  _documentType: 'schedule-c';
  businessName?: string;
  ein?: string;
  grossReceipts?: number;
  returnsAndAllowances?: number;
  costOfGoodsSold?: number;
  grossProfit?: number;
  otherIncome?: number;
  totalIncome?: number;
  expenses?: Record<string, number>;
  totalExpenses?: number;
  netProfit?: number;
  taxYear?: number;
}

// --- Koinly 8949 ---
export interface ParsedKoinly8949Schema extends ParserMetadata {
  _documentType: 'koinly-8949';
  shortTerm?: Array<{
    exchange?: string;
    boxCategory?: string;
    proceeds?: number;
    costBasis?: number;
    adjustment?: number;
    gainLoss?: number;
  }>;
  longTerm?: Array<{
    exchange?: string;
    boxCategory?: string;
    proceeds?: number;
    costBasis?: number;
    adjustment?: number;
    gainLoss?: number;
  }>;
}

// --- Koinly Schedule ---
export interface ParsedKoinlyScheduleSchema extends ParserMetadata {
  _documentType: 'koinly-schedule';
  scheduleType?: 'D' | '1' | 'both';
  // Schedule D
  shortTermGainLoss?: number;
  longTermGainLoss?: number;
  totalGainLoss?: number;
  // Schedule 1
  digitalAssetIncome?: number;
  otherIncome?: Array<{ description: string; amount: number }>;
  taxYear?: number;
}

// Union of all typed parser outputs
export type ParsedDocumentSchema =
  | ParsedW2Schema
  | Parsed1099NECSchema
  | Parsed1099DIVSchema
  | Parsed1099INTSchema
  | Parsed1099BSchema
  | Parsed1099MISCSchema
  | Parsed1099RSchema
  | Parsed1099CompositeSchema
  | Parsed1098Schema
  | ParsedK1Schema
  | ParsedReceiptSchema
  | ParsedBankStatementSchema
  | ParsedCreditCardSchema
  | ParsedRetirementSchema
  | ParsedScheduleCSchema
  | ParsedKoinly8949Schema
  | ParsedKoinlyScheduleSchema;
