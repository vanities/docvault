// =============================================================================
// Type Definitions
// =============================================================================
// For configuration values (entities, categories, etc.), see src/config.ts

// Entity types - dynamic, loaded from server config
export type Entity = string;

// Document types
export type DocumentType =
  | 'w2'
  | '1099-nec'
  | '1099-misc'
  | '1099-r'
  | '1099-div'
  | '1099-int'
  | '1099-b'
  | '1099-composite'
  | '1098'
  | 'k-1'
  | 'retirement-statement'
  | 'receipt'
  | 'invoice'
  | 'crypto'
  | 'return'
  | 'contract'
  | 'other'
  // Business documents (not tied to a tax year)
  | 'formation'
  | 'ein-letter'
  | 'license'
  | 'business-agreement'
  | 'operating-agreement'
  | 'insurance-policy'
  // General document types (not tied to tax year or business)
  | 'bank-statement'
  | 'credit-card-statement'
  | 'statement'
  | 'letter'
  | 'certificate'
  | 'medical-record'
  | 'appraisal';

// Expense categories for Schedule C
export type ExpenseCategory =
  | 'meals'
  | 'software'
  | 'equipment'
  | 'office-supplies'
  | 'professional-services'
  | 'travel'
  | 'utilities'
  | 'insurance'
  | 'taxes-licenses'
  | 'childcare'
  | 'medical'
  | 'education'
  | 'home-improvement'
  | 'other';

// Parsed data structures
export interface ParsedW2 {
  employer: string;
  employerAddress?: string;
  ein: string;
  wages: number; // Box 1
  federalWithheld: number; // Box 2
  socialSecurityWages: number; // Box 3
  socialSecurityTax: number; // Box 4
  medicareWages: number; // Box 5
  medicareTax: number; // Box 6
  stateWages?: number; // Box 16
  stateWithheld?: number; // Box 17
  localWages?: number; // Box 18
  localWithheld?: number; // Box 19
  incomeSourceId?: string; // Links to INCOME_SOURCES in config
}

export interface Parsed1099 {
  payer: string;
  payerAddress?: string;
  payerTin: string;
  amount: number; // Box varies by 1099 type
  federalWithheld?: number;
  stateWithheld?: number;
  accountNumber?: string;
  incomeSourceId?: string; // Links to INCOME_SOURCES in config
}

export interface Parsed1099BSummary {
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
}

export interface ParsedComposite1099 {
  payer: string;
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
  b?: Parsed1099BSummary;
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

export interface ParsedReceipt {
  vendor: string;
  amount: number;
  date: string; // ISO date string
  category: ExpenseCategory;
  description?: string;
  paymentMethod?: string;
}

export interface ParsedCrypto {
  source: 'koinly' | 'coinbase' | 'kraken' | 'other';
  taxYear: number;
  shortTermGains: number;
  longTermGains: number;
  totalProceeds: number;
  costBasis: number;
  transactions?: number;
}

export interface ParsedK1 {
  entityName: string; // Partnership/S-Corp/Trust name
  entityEin: string; // Entity EIN
  formType: 'partnership' | 's-corp' | 'trust'; // 1065, 1120-S, or 1041
  partnerName?: string;
  partnerTin?: string;
  ordinaryIncome?: number; // Box 1
  rentalIncome?: number; // Box 2
  otherRentalIncome?: number; // Box 3
  guaranteedPayments?: number; // Box 4
  interestIncome?: number; // Box 5
  dividends?: number; // Box 6
  royalties?: number; // Box 7
  shortTermCapitalGain?: number; // Box 8
  longTermCapitalGain?: number; // Box 9
  section1231Gain?: number; // Box 10
  otherIncome?: number; // Box 11
  section179Deduction?: number; // Box 12
  otherDeductions?: number; // Box 13
  selfEmploymentEarnings?: number; // Box 14
  distributions?: number; // Box 19
  taxYear?: number;
}

export interface ParsedRetirementStatement {
  institution: string;
  accountType: string; // e.g. "Solo 401(k)", "SEP-IRA", "Traditional IRA"
  employerContributions: number;
  employeeContributions: number;
  totalContributions: number;
  taxYear: number;
  accountNumber?: string;
}

export interface ParsedBankStatement {
  institution: string; // e.g. "Chase", "Bank of America"
  accountType: string; // e.g. "Checking", "Savings", "Business Checking"
  accountNumber?: string; // last 4 digits
  totalDeposits: number; // sum of all deposits/credits for the period
  depositCount?: number; // number of deposit transactions (also may be depositsCount)
  totalWithdrawals?: number; // sum of all withdrawals for the period
  beginningBalance?: number; // opening balance at start of statement period
  endingBalance?: number; // closing balance at end of statement period
  startDate?: string; // statement period start (YYYY-MM-DD)
  endDate?: string; // statement period end (YYYY-MM-DD)
  periodLabel?: string; // e.g. "January 2025"
}

export interface ParsedCreditCardStatement {
  institution: string; // e.g. "Chase", "Capital One"
  accountNumber?: string; // masked card number
  newBalance: number; // statement balance
  previousBalance?: number;
  payments?: number; // payments made during period
  purchases?: number; // total purchases during period
  creditLimit?: number;
  paymentDueDate?: string; // YYYY-MM-DD
  statementDate?: string; // YYYY-MM-DD
  statementPeriod?: string; // e.g. "11/22/25 - 12/21/25"
}

// Main document interface
export interface TaxDocument {
  id: string;
  fileName: string;
  fileType: string; // e.g., 'application/pdf', 'image/png'
  fileSize: number;
  filePath?: string; // Local path if available
  type: DocumentType;
  entity: Entity;
  taxYear: number;
  tags: string[];
  notes?: string;
  tracked: boolean; // Whether to include in totals (default true)
  incomeSourceId?: string; // For W-2s: links to INCOME_SOURCES
  parsedData?:
    | ParsedW2
    | Parsed1099
    | ParsedComposite1099
    | ParsedReceipt
    | ParsedCrypto
    | ParsedK1
    | ParsedRetirementStatement
    | ParsedBankStatement
    | ParsedCreditCardStatement;
  createdAt: string; // ISO date string
  updatedAt: string; // ISO date string
}

// Summary types for dashboard
export interface IncomeSummary {
  entity: Entity;
  taxYear: number;
  w2Total: number;
  w2Count: number;
  income1099Total: number;
  income1099Count: number;
  k1Total: number;
  k1Count: number;
  totalIncome: number;
  federalWithheld: number;
  stateWithheld: number;
  capitalGainsTotal: number;
  capitalGainsShortTerm: number;
  capitalGainsLongTerm: number;
}

export interface ExpenseSummaryItem {
  category: ExpenseCategory;
  total: number;
  deductibleAmount: number;
  count: number;
}

export interface ExpenseSummary {
  entity: Entity;
  taxYear: number;
  items: ExpenseSummaryItem[];
  totalExpenses: number;
  totalDeductible: number;
}

// Invoice summary types for CPA prep
export interface InvoiceCustomerGroup {
  customer: string;
  total: number;
  count: number;
}

export interface InvoiceSummaryData {
  entity: Entity;
  taxYear: number;
  invoiceTotal: number;
  invoiceCount: number;
  byCustomer: InvoiceCustomerGroup[];
}

// Retirement summary for QuickStats
export interface RetirementSummary {
  totalContributions: number;
  employerContributions: number;
  employeeContributions: number;
  statementCount: number;
  byAccount: { institution: string; accountType: string; total: number }[];
}

// Bank deposit summary for QuickStats
export interface BankDepositSummary {
  totalDeposits: number;
  depositCount: number;
  statementCount: number;
  byAccount: { institution: string; accountType: string; total: number }[];
}

// Reminders
export interface Reminder {
  id: string;
  entityId: Entity;
  title: string;
  dueDate: string; // YYYY-MM-DD
  recurrence?: 'yearly' | 'monthly' | 'quarterly' | null;
  status: 'pending' | 'completed' | 'dismissed';
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

// Todos
export interface Todo {
  id: string;
  title: string;
  status: 'pending' | 'completed';
  createdAt: string;
  updatedAt: string;
}

// Crypto tracking types
export type CryptoExchangeId = 'coinbase' | 'gemini' | 'kraken';
export type CryptoChain = 'btc' | 'eth';

export interface CryptoExchangeConfig {
  id: CryptoExchangeId;
  apiKey: string;
  apiSecret: string;
  passphrase?: string; // Coinbase Advanced requires this
  enabled: boolean;
}

export interface CryptoWalletConfig {
  id: string; // user-chosen unique id
  address: string;
  chain: CryptoChain;
  label: string; // e.g. "Cold storage", "Hardware wallet"
}

export interface CryptoBalance {
  asset: string; // e.g. "BTC", "ETH", "USDC"
  amount: number;
  usdValue?: number;
}

export interface CryptoSourceBalance {
  sourceId: string; // exchange id or wallet id
  sourceType: 'exchange' | 'wallet';
  label: string; // e.g. "Coinbase", "Cold storage"
  balances: CryptoBalance[];
  totalUsdValue: number;
  error?: string;
  lastUpdated: string; // ISO date
}

export interface CryptoPortfolio {
  sources: CryptoSourceBalance[];
  totalUsdValue: number;
  byAsset: CryptoBalance[];
  lastUpdated: string;
}

export interface CryptoSettings {
  exchanges: CryptoExchangeConfig[];
  wallets: CryptoWalletConfig[];
}

// Crypto gains tracking
export interface CryptoAssetGains {
  asset: string;
  totalAmount: number;
  totalCostBasis: number;
  currentValue: number;
  unrealizedGain: number;
  shortTermGain: number;
  longTermGain: number;
  lots: {
    amount: number;
    costPerUnit: number;
    date: string;
    gainType: 'short-term' | 'long-term';
  }[];
}

export interface CryptoGainsSummary {
  assets: CryptoAssetGains[];
  totalCostBasis: number;
  totalCurrentValue: number;
  totalUnrealizedGain: number;
  totalShortTermGain: number;
  totalLongTermGain: number;
  lastUpdated: string;
  tradeCount: number;
}

// Brokerage tracking types
export type BrokerId = 'vanguard' | 'fidelity' | 'robinhood' | 'navy-federal' | 'chase';

export interface BrokerHolding {
  ticker: string;
  shares: number;
  costBasis?: number;
  purchaseDate?: string; // ISO date string for short/long-term gain classification
  label?: string;
  price?: number;
  marketValue?: number;
  gainLoss?: number;
  gainLossPercent?: number;
  gainType?: 'short-term' | 'long-term' | 'unknown';
}

export interface BrokerAccount {
  id: string;
  broker: BrokerId;
  name: string;
  holdings: BrokerHolding[];
  totalValue: number;
  totalCostBasis: number;
  totalGainLoss: number;
}

export interface BrokerPortfolio {
  accounts: BrokerAccount[];
  totalValue: number;
  totalCostBasis: number;
  totalGainLoss: number;
  shortTermGains?: number;
  longTermGains?: number;
  lastUpdated: string;
}

// Portfolio snapshot types
export interface PortfolioSnapshot {
  date: string; // ISO date (YYYY-MM-DD)
  totalValue: number;
  cryptoValue: number;
  brokerValue: number;
  shortTermGains: number;
  longTermGains: number;
}

// Sync status (Dropbox)
export interface SyncStatus {
  status: 'ok' | 'error' | 'syncing' | 'unknown';
  lastSync: string | null;
  entitiesSynced: number;
  errors: number;
  nextSync: string | null;
}

// App state
export interface AppState {
  selectedEntity: Entity;
  selectedTaxYear: number;
  documents: TaxDocument[];
}

// Filing status for TurboTax workflow
export interface TaxYearStatus {
  year: number;
  status: 'in-progress' | 'ready-to-file' | 'filed';
  filedDate?: string;
  confirmationNumber?: string;
  turboTaxFile?: string;
  returnPdf?: string;
}
