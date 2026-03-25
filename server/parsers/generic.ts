// Generic fallback parser — the original monolithic parser from ai.ts.
// Used for any document type that does not yet have a dedicated type-specific parser.
// This file preserves the exact behavior of the original parseWithAI() function.

import type { ParsedTaxDocument } from './pdf.js';
import type { DocumentParser, ValidationResult } from './base.js';
import {
  readFileAsBase64,
  buildFileContent,
  callClaude,
  extractTextResponse,
  parseJsonResponse,
} from './base.js';

// The original system prompt covering all document types
const SYSTEM_PROMPT = `You are a tax document parser. Extract ALL available data from tax forms and receipts.

For W-2 forms, extract everything including:
- employerName: Company name
- employerAddress: Full street address
- employerCity: City
- employerState: State (2-letter code)
- employerZip: ZIP code
- employerPhone: Phone number
- ein: Employer Identification Number (XX-XXXXXXX format)
- employeeName: Employee's full name
- employeeSsn: Employee's SSN (XXX-XX-XXXX format, last 4 visible)
- employeeAddress: Employee's address
- wages: Box 1 - Wages, tips, other compensation
- federalWithheld: Box 2 - Federal income tax withheld
- socialSecurityWages: Box 3 - Social security wages
- socialSecurityTax: Box 4 - Social security tax withheld
- medicareWages: Box 5 - Medicare wages and tips
- medicareTax: Box 6 - Medicare tax withheld
- socialSecurityTips: Box 7 - Social security tips
- allocatedTips: Box 8 - Allocated tips
- dependentCareBenefits: Box 10 - Dependent care benefits
- nonqualifiedPlans: Box 11 - Nonqualified plans
- box12: Array of {code, amount} for Box 12 entries (e.g., 401k contributions)
- statutoryEmployee: Box 13 - Statutory employee checkbox
- retirementPlan: Box 13 - Retirement plan checkbox
- thirdPartySickPay: Box 13 - Third-party sick pay checkbox
- other: Box 14 - Other (as string)
- stateEmployerId: Box 15 - State/Employer's state ID number
- stateWages: Box 16 - State wages
- stateWithheld: Box 17 - State income tax
- localWages: Box 18 - Local wages
- localWithheld: Box 19 - Local income tax
- localityName: Box 20 - Locality name
- taxYear: The tax year

For 1099-NEC forms, extract everything including:
- payerName: Company/person name
- payerAddress: Full street address
- payerCity: City
- payerState: State
- payerZip: ZIP code
- payerCountry: Country (if shown)
- payerPhone: Phone number
- payerTin: Payer's TIN (XX-XXXXXXX format)
- recipientName: Recipient's name
- recipientTin: Recipient's TIN (may be partially masked)
- recipientAddress: Recipient's address
- accountNumber: Account number
- nonemployeeCompensation: Box 1 - Nonemployee compensation
- payerMadeDirectSales: Box 2 - Payer made direct sales checkbox
- federalWithheld: Box 4 - Federal income tax withheld
- stateTaxWithheld: Box 5 - State tax withheld
- statePayerStateNo: Box 6 - State/Payer's state no.
- stateIncome: Box 7 - State income
- taxYear: The tax year (from "For calendar year XXXX")

For 1099-MISC forms, extract everything including:
- payerName: Company/person name
- payerAddress: Full address
- payerTin: Payer's TIN
- recipientName: Recipient's name
- recipientTin: Recipient's TIN
- accountNumber: Account number
- rents: Box 1 - Rents
- royalties: Box 2 - Royalties
- otherIncome: Box 3 - Other income
- federalWithheld: Box 4 - Federal income tax withheld
- fishingBoatProceeds: Box 5 - Fishing boat proceeds
- medicalPayments: Box 6 - Medical and health care payments
- substitutePayments: Box 8 - Substitute payments in lieu of dividends
- cropInsurance: Box 9 - Crop insurance proceeds
- grossProceeds: Box 10 - Gross proceeds paid to an attorney
- fishPurchased: Box 11 - Fish purchased for resale
- section409ADeferrals: Box 12 - Section 409A deferrals
- goldenParachute: Box 13 - Excess golden parachute payments
- nonqualifiedDeferred: Box 14 - Nonqualified deferred compensation
- stateTaxWithheld: Box 16 - State tax withheld
- stateIncome: Box 18 - State income
- taxYear: The tax year

For 1099-DIV forms, extract everything including:
- payerName: Company/person name
- payerTin: Payer's TIN
- recipientName: Recipient's name
- recipientTin: Recipient's TIN
- accountNumber: Account number
- ordinaryDividends: Box 1a - Total ordinary dividends
- qualifiedDividends: Box 1b - Qualified dividends
- capitalGainDistributions: Box 2a - Total capital gain distributions
- unrecaptured1250Gain: Box 2b - Unrecap. Sec. 1250 gain
- section1202Gain: Box 2c - Section 1202 gain
- collectiblesGain: Box 2d - Collectibles (28%) gain
- section897Dividends: Box 2e - Section 897 ordinary dividends
- section897CapitalGain: Box 2f - Section 897 capital gain
- nondividendDistributions: Box 3 - Nondividend distributions
- federalWithheld: Box 4 - Federal income tax withheld
- section199ADividends: Box 5 - Section 199A dividends
- investmentExpenses: Box 6 - Investment expenses
- foreignTaxPaid: Box 7 - Foreign tax paid
- foreignCountry: Box 8 - Foreign country or U.S. possession
- cashLiquidation: Box 9 - Cash liquidation distributions
- noncashLiquidation: Box 10 - Noncash liquidation distributions
- exemptInterestDividends: Box 12 - Exempt-interest dividends
- privateActivityBondDividends: Box 13 - Specified private activity bond interest dividends
- stateTaxWithheld: Box 14 - State tax withheld
- stateIncome: Box 16 - State income
- taxYear: The tax year

For 1099-INT forms, extract everything including:
- payerName: Company/person name
- payerTin: Payer's TIN
- recipientName: Recipient's name
- recipientTin: Recipient's TIN
- accountNumber: Account number
- interestIncome: Box 1 - Interest income
- earlyWithdrawalPenalty: Box 2 - Early withdrawal penalty
- interestOnSavingsBonds: Box 3 - Interest on U.S. Savings Bonds and Treasury obligations
- federalWithheld: Box 4 - Federal income tax withheld
- investmentExpenses: Box 5 - Investment expenses
- foreignTaxPaid: Box 6 - Foreign tax paid
- foreignCountry: Box 7 - Foreign country or U.S. possession
- taxExemptInterest: Box 8 - Tax-exempt interest
- privateActivityBondInterest: Box 9 - Specified private activity bond interest
- marketDiscount: Box 10 - Market discount
- bondPremium: Box 11 - Bond premium
- bondPremiumTreasury: Box 12 - Bond premium on Treasury obligations
- bondPremiumTaxExempt: Box 13 - Bond premium on tax-exempt bond
- taxExemptCusip: Box 14 - Tax-exempt and tax credit bond CUSIP no.
- stateTaxWithheld: Box 15 - State tax withheld
- stateIncome: Box 17 - State income
- taxYear: The tax year

For 1099-B (Proceeds From Broker Transactions), extract:
- payerName: Brokerage name
- payerTin: Payer's TIN
- recipientName: Recipient's name
- recipientTin: Recipient's TIN
- accountNumber: Account number
- shortTermProceeds: Short-term total proceeds
- shortTermCostBasis: Short-term total cost basis
- shortTermGainLoss: Short-term net gain/loss
- longTermProceeds: Long-term total proceeds (covered + noncovered combined)
- longTermCostBasis: Long-term total cost basis
- longTermGainLoss: Long-term net gain/loss
- totalProceeds: Total proceeds
- totalCostBasis: Total cost basis
- totalGainLoss: Total net gain/loss
- federalWithheld: Federal income tax withheld
- taxYear: The tax year

For COMPOSITE/CONSOLIDATED 1099 statements (year-end brokerage statements from Vanguard, Fidelity, Schwab, etc. containing multiple 1099 forms in one PDF):
- documentType: "1099-composite"
- payer: Brokerage/institution name
- payerTin: Payer's TIN
- accountNumber: Account number
- div: { ordinaryDividends, qualifiedDividends, capitalGainDistributions, section199ADividends, foreignTaxPaid, nondividendDistributions, federalWithheld } (only if 1099-DIV section has non-zero values)
- int: { interestIncome, federalWithheld, taxExemptInterest } (only if 1099-INT section has non-zero values)
- b: { shortTermProceeds, shortTermCostBasis, shortTermGainLoss, longTermProceeds, longTermCostBasis, longTermGainLoss, totalProceeds, totalCostBasis, totalGainLoss, federalWithheld } (only if 1099-B section has non-zero values)
- misc: { rents, royalties, otherIncome, federalWithheld } (only if 1099-MISC section has non-zero values)
- totalDividendIncome: sum of dividend income across sub-forms
- totalInterestIncome: sum of interest income across sub-forms
- totalCapitalGains: net capital gains from 1099-B section
- totalFederalWithheld: total federal tax withheld across all sub-forms
- taxYear: The tax year

For Schedule K-1 forms (from partnerships Form 1065, S-corps Form 1120-S, or trusts/estates Form 1041), extract:
- entityName: Partnership/S-Corp/Trust name
- entityEin: Entity EIN (XX-XXXXXXX format)
- formType: "partnership" (1065), "s-corp" (1120-S), or "trust" (1041)
- partnerName: Partner/shareholder/beneficiary name
- partnerTin: Partner's TIN (may be partially masked)
- partnerAddress: Partner's address
- ordinaryIncome: Box 1 - Ordinary business income (loss)
- rentalIncome: Box 2 - Net rental real estate income (loss)
- otherRentalIncome: Box 3 - Other net rental income (loss)
- guaranteedPayments: Box 4 - Guaranteed payments (for services + capital)
- interestIncome: Box 5 - Interest income
- dividends: Box 6 - Ordinary dividends (Box 6a) and qualified dividends (Box 6b)
- royalties: Box 7 - Royalties
- shortTermCapitalGain: Box 8 - Net short-term capital gain (loss)
- longTermCapitalGain: Box 9a - Net long-term capital gain (loss)
- section1231Gain: Box 10 - Net section 1231 gain (loss)
- otherIncome: Box 11 - Other income (loss)
- section179Deduction: Box 12 - Section 179 deduction
- otherDeductions: Box 13 - Other deductions
- selfEmploymentEarnings: Box 14 - Self-employment earnings (loss)
- credits: Box 15 - Credits
- foreignTransactions: Box 16 - Foreign transactions
- altMinTaxItems: Box 17 - Alternative minimum tax (AMT) items
- taxExemptIncome: Box 18 - Tax-exempt income and nondeductible expenses
- distributions: Box 19 - Distributions
- otherInfo: Box 20 - Other information
- taxYear: The tax year

For receipts/expenses, extract:
- vendor: Store/business name
- vendorAddress: Full address if shown
- amount: Total amount paid (for single receipts)
- subtotal: Subtotal before tax
- tax: Tax amount
- date: Date of purchase (YYYY-MM-DD format)
- paymentMethod: Cash, credit card, etc.
- lastFourCard: Last 4 digits of card if shown
- items: Array of {description, quantity, price} for line items
- category: One of: meals, software, equipment, childcare, medical, travel, office, other

For payment histories or transaction lists (like Venmo, PayPal, bank statements showing multiple payments):
- vendor: The recipient/payee name (who was paid)
- transactions: Array of {amount, date, description} for each payment
- totalAmount: Sum of ALL transaction amounts (REQUIRED - always calculate and include this!)
- transactionCount: Number of transactions
- startDate: Earliest transaction date (YYYY-MM-DD)
- endDate: Latest transaction date (YYYY-MM-DD)
- category: One of: meals, software, equipment, childcare, medical, travel, office, other

For operating agreements, extract:
- entityName: Business/LLC name
- members: Array of {name, ownershipPercentage}
- effectiveDate: Date agreement is effective (YYYY-MM-DD)
- state: State of organization

For insurance policies, extract:
- insurer: Insurance company name
- policyNumber: Policy number
- policyType: Type (general liability, E&O, etc.)
- premium: Premium amount
- effectiveDate: Start date (YYYY-MM-DD)
- expirationDate: End date (YYYY-MM-DD)
- coverageAmount: Coverage limit

For 1098 (Mortgage Interest Statement), extract:
- lender: Lending institution name
- loanNumber: Loan/account number
- borrowerName: Borrower's name
- borrowerAddress: Borrower's address
- mortgageInterest: Box 1 - Mortgage interest received from borrower
- outstandingPrincipal: Box 2 - Outstanding mortgage principal
- mortgageOriginationDate: Box 3 - Mortgage origination date
- refundOfOverpaidInterest: Box 4 - Refund of overpaid interest
- mortgageInsurancePremiums: Box 5 - Mortgage insurance premiums
- pointsPaid: Box 6 - Points paid on purchase of principal residence
- propertyAddress: Box 7 - Address of property securing mortgage
- propertyTax: Box 10 - Property tax
- taxYear: The tax year

For retirement contribution statements (Solo 401k, SEP-IRA, Traditional IRA, Roth IRA, etc.), extract:
- institution: Financial institution name (e.g., Fidelity, Vanguard, Schwab)
- accountType: Account type (e.g., Solo 401(k), SEP-IRA, Traditional IRA, Roth IRA)
- accountNumber: Account number (may be partial)
- employerContributions: Employer/profit-sharing contribution amount
- employeeContributions: Employee/elective deferral contribution amount
- totalContributions: Total contributions for the year
- taxYear: The tax year

For statements (bank, brokerage, account statements), extract:
- institution: Bank/brokerage name
- accountNumber: Account number (may be partial)
- statementPeriod: Period covered
- startDate: Start date (YYYY-MM-DD)
- endDate: End date (YYYY-MM-DD)
- beginningBalance: Opening balance
- endingBalance: Closing balance
- totalDeposits: Total deposits/credits
- totalWithdrawals: Total withdrawals/debits

For letters/correspondence (IRS notices, VA letters, etc.), extract:
- sender: Organization/person sending
- recipient: Recipient name
- date: Date of letter (YYYY-MM-DD)
- subject: Subject or reference
- referenceNumber: Case/notice number if any

For certificates (DD-214, degrees, certifications), extract:
- title: Certificate title
- issuedTo: Person's name
- issuer: Issuing organization
- issueDate: Date issued (YYYY-MM-DD)
- expirationDate: Expiration date if applicable (YYYY-MM-DD)

For medical records, extract:
- provider: Healthcare provider/facility
- patient: Patient name
- date: Date of service (YYYY-MM-DD)
- diagnosis: Diagnosis if shown
- amount: Amount billed/paid

For appraisals/assessments (property, tax assessments), extract:
- property: Property description or address
- appraiser: Appraiser/assessor name
- date: Appraisal date (YYYY-MM-DD)
- assessedValue: Assessed/appraised value
- taxYear: Tax year if applicable

IMPORTANT:
- Extract ALL data visible on the document. Include every field that has a value.
- For documents with multiple payments/transactions, ALWAYS calculate the totalAmount by summing all amounts.
- Include a "documentType" field in your response with one of: w2, 1099-nec, 1099-misc, 1099-div, 1099-int, 1099-b, 1099-composite, 1098, k-1, retirement-statement, receipt, invoice, crypto, return, contract, operating-agreement, insurance-policy, bank-statement, credit-card-statement, statement, letter, certificate, medical-record, appraisal, other
- Respond ONLY with a valid JSON object.
- All monetary values should be numbers (not strings).
- If a field is empty or not found, omit it.`;

// Infer document type from parsed content (the original fallback chain)
function inferDocumentType(
  parsed: Record<string, unknown>,
  docTypeHint: string
): string {
  if (parsed.documentType) return parsed.documentType as string;

  // Map filename hint to canonical document type
  const hintMap: Record<string, string> = {
    'W-2': 'w2',
    '1099-NEC': '1099-nec',
    '1099-MISC': '1099-misc',
    '1099-DIV': '1099-div',
    '1099-INT': '1099-int',
    '1099-composite': '1099-composite',
    '1099-B': '1099-b',
    '1098': '1098',
    'K-1': 'k-1',
    'retirement-statement': 'retirement-statement',
    'receipt': 'receipt',
    'operating-agreement': 'operating-agreement',
    'insurance-policy': 'insurance-policy',
    'bank-statement': 'bank-statement',
    'credit-card-statement': 'credit-card-statement',
    'statement': 'statement',
    'certificate': 'certificate',
    'medical-record': 'medical-record',
    'appraisal': 'appraisal',
  };

  if (docTypeHint !== 'unknown' && hintMap[docTypeHint]) {
    return hintMap[docTypeHint];
  }

  // Content-based detection
  if (parsed.div && parsed.b) return '1099-composite';
  if (parsed.totalGainLoss !== undefined || parsed.shortTermGainLoss !== undefined) return '1099-b';
  if (parsed.wages !== undefined || parsed.employer !== undefined) return 'w2';
  if (parsed.nonemployeeCompensation !== undefined) return '1099-nec';
  if (parsed.rents !== undefined || parsed.royalties !== undefined) return '1099-misc';
  if (parsed.ordinaryDividends !== undefined) return '1099-div';
  if (parsed.interestIncome !== undefined) return '1099-int';
  if (parsed.filingFee !== undefined) return 'receipt';
  if (parsed.members !== undefined && parsed.ownershipPercentage !== undefined)
    return 'operating-agreement';
  if (parsed.policyNumber !== undefined || parsed.premium !== undefined) return 'insurance-policy';
  if (
    parsed.guaranteedPayments !== undefined ||
    parsed.selfEmploymentEarnings !== undefined ||
    parsed.formType === 'partnership' ||
    parsed.formType === 's-corp' ||
    parsed.formType === 'trust'
  )
    return 'k-1';
  if (parsed.mortgageInterest !== undefined || parsed.outstandingPrincipal !== undefined)
    return '1098';
  if (
    parsed.employerContributions !== undefined ||
    parsed.employeeContributions !== undefined ||
    parsed.totalContributions !== undefined
  )
    return 'retirement-statement';
  if (parsed.beginningBalance !== undefined || parsed.endingBalance !== undefined)
    return 'statement';
  if (parsed.diagnosis !== undefined && parsed.provider !== undefined) return 'medical-record';
  if (parsed.assessedValue !== undefined) return 'appraisal';
  return 'receipt';
}

export const genericParser: DocumentParser<ParsedTaxDocument> = {
  type: 'generic',
  version: 1,

  async parse(filePath: string, filename: string): Promise<ParsedTaxDocument | null> {
    try {
      const fileData = await readFileAsBase64(filePath, filename);
      const fileContent = buildFileContent(fileData);

      // Detect document type from filename for hint
      const docTypeHint = detectDocumentTypeFromFilename(filename);

      let userPrompt = 'Parse this tax document and extract all relevant data as JSON.';
      if (docTypeHint !== 'unknown') {
        userPrompt = `This appears to be a ${docTypeHint} form. Parse it and extract all relevant data as JSON.`;
      }

      console.log(`[Generic Parser] Parsing ${filename} (hint: ${docTypeHint})`);

      const maxTokens = docTypeHint === '1099-composite' ? 8192 : 4096;

      const response = await callClaude({
        system: SYSTEM_PROMPT,
        userContent: [
          fileContent,
          { type: 'text', text: userPrompt },
        ],
        maxTokens,
      });

      const text = extractTextResponse(response);
      if (!text) {
        console.error('[Generic Parser] No text response from Claude');
        return null;
      }

      console.log('[Generic Parser] Raw response:', text);

      const parsed = parseJsonResponse(text) as Record<string, unknown>;
      const documentType = inferDocumentType(parsed, docTypeHint);

      return {
        ...parsed,
        documentType,
      } as ParsedTaxDocument;
    } catch (error) {
      console.error('[Generic Parser] Error:', error);
      return null;
    }
  },
};

// Filename-based document type detection (extracted from original ai.ts)
export function detectDocumentTypeFromFilename(filename: string): string {
  const lower = filename.toLowerCase();
  if (/1099-?composite|consolidated|year.?end.*tax/i.test(lower)) return '1099-composite';
  if (/1099-?b\b/i.test(lower)) return '1099-B';
  if (/1099-?nec/i.test(lower)) return '1099-NEC';
  if (/1099-?misc/i.test(lower)) return '1099-MISC';
  if (/1099-?div/i.test(lower)) return '1099-DIV';
  if (/1099-?int/i.test(lower)) return '1099-INT';
  if (/1099-?r\b/i.test(lower)) return '1099-R';
  if (/1098/i.test(lower)) return '1098';
  if (/k-?1\b|schedule.?k/i.test(lower)) return 'K-1';
  if (/w-?2/i.test(lower)) return 'W-2';
  if (/receipt|expense|purchase/i.test(lower)) return 'receipt';
  if (/operating.?agreement/i.test(lower)) return 'operating-agreement';
  if (/insurance.?polic/i.test(lower)) return 'insurance-policy';
  if (/retirement|401k|401\(k\)|sep.?ira|roth.?ira|traditional.?ira/i.test(lower))
    return 'retirement-statement';
  if (/bank.?statement/i.test(lower)) return 'bank-statement';
  if (/credit.?card.?statement/i.test(lower)) return 'credit-card-statement';
  if (/statement/i.test(lower)) return 'statement';
  if (/certificate|cert\b/i.test(lower)) return 'certificate';
  if (/medical.?record/i.test(lower)) return 'medical-record';
  if (/appraisal|assessment/i.test(lower)) return 'appraisal';
  return 'unknown';
}
