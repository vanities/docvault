import { promises as fs } from 'fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

// Types for parsed data
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

// Extract text from PDF
async function extractPdfText(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  // Convert Buffer to Uint8Array (pdfjs requires Uint8Array, not Buffer)
  const data = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const pdf = await pdfjs.getDocument({ data }).promise;

  let fullText = '';

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map((item) => ('str' in item ? item.str : '')).join(' ');
    fullText += pageText + '\n';
  }

  return fullText;
}

// Parse dollar amount from text
function parseAmount(text: string): number | undefined {
  // Match patterns like $1,234.56 or 1234.56
  const match = text.match(/\$?\s*([\d,]+\.?\d*)/);
  if (match) {
    return parseFloat(match[1].replace(/,/g, ''));
  }
  return undefined;
}

// Parse W-2 from text
function parseW2(text: string): ParsedW2 {
  const result: ParsedW2 = { documentType: 'w2' };

  // Box 1: Wages, tips, other compensation
  const wagesMatch = text.match(/(?:box\s*1|wages.*compensation)[:\s]*\$?([\d,]+\.?\d*)/i);
  if (wagesMatch) result.wages = parseAmount(wagesMatch[1]);

  // Box 2: Federal income tax withheld
  const fedWithheldMatch = text.match(
    /(?:box\s*2|federal.*(?:income\s*)?tax\s*withheld)[:\s]*\$?([\d,]+\.?\d*)/i
  );
  if (fedWithheldMatch) result.federalWithheld = parseAmount(fedWithheldMatch[1]);

  // Box 3: Social security wages
  const ssWagesMatch = text.match(/(?:box\s*3|social\s*security\s*wages)[:\s]*\$?([\d,]+\.?\d*)/i);
  if (ssWagesMatch) result.socialSecurityWages = parseAmount(ssWagesMatch[1]);

  // Box 4: Social security tax withheld
  const ssTaxMatch = text.match(
    /(?:box\s*4|social\s*security\s*tax\s*withheld)[:\s]*\$?([\d,]+\.?\d*)/i
  );
  if (ssTaxMatch) result.socialSecurityTax = parseAmount(ssTaxMatch[1]);

  // Box 5: Medicare wages
  const medicareWagesMatch = text.match(/(?:box\s*5|medicare\s*wages)[:\s]*\$?([\d,]+\.?\d*)/i);
  if (medicareWagesMatch) result.medicareWages = parseAmount(medicareWagesMatch[1]);

  // Box 6: Medicare tax withheld
  const medicareTaxMatch = text.match(
    /(?:box\s*6|medicare\s*tax\s*withheld)[:\s]*\$?([\d,]+\.?\d*)/i
  );
  if (medicareTaxMatch) result.medicareTax = parseAmount(medicareTaxMatch[1]);

  // Employer name - look for common patterns
  const employerMatch = text.match(
    /(?:employer'?s?\s*name|employer\s*identification)[:\s]*([A-Z][A-Za-z0-9\s,]+?)(?:\n|EIN|\d{2}-)/i
  );
  if (employerMatch) result.employer = employerMatch[1].trim();

  // EIN
  const einMatch = text.match(/(?:EIN|employer.*identification.*number)[:\s]*(\d{2}-?\d{7})/i);
  if (einMatch) result.ein = einMatch[1];

  // State wages (Box 16)
  const stateWagesMatch = text.match(/(?:box\s*16|state\s*wages)[:\s]*\$?([\d,]+\.?\d*)/i);
  if (stateWagesMatch) result.stateWages = parseAmount(stateWagesMatch[1]);

  // State tax withheld (Box 17)
  const stateWithheldMatch = text.match(
    /(?:box\s*17|state\s*(?:income\s*)?tax)[:\s]*\$?([\d,]+\.?\d*)/i
  );
  if (stateWithheldMatch) result.stateWithheld = parseAmount(stateWithheldMatch[1]);

  return result;
}

// Parse 1099-NEC from text
function parse1099NEC(text: string): Parsed1099NEC {
  const result: Parsed1099NEC = { documentType: '1099-nec' };

  console.log('Parsing 1099-NEC, full text:', text);

  // Look for PAYER'S TIN pattern
  const payerTinMatch = text.match(/PAYER'?S?\s*TIN\s*(\d{2}-?\d{7})/i);
  if (payerTinMatch) result.payerTin = payerTinMatch[1];

  // Look for RECIPIENT'S TIN pattern
  const recipientTinMatch = text.match(/RECIPIENT'?S?\s*TIN\s*(\d{2}-?\d{7})/i);
  if (recipientTinMatch) {
    // Store as additional info
    console.log('Recipient TIN:', recipientTinMatch[1]);
  }

  // Box 1: Nonemployee compensation - try multiple patterns
  // Pattern 1: Look for a dollar amount near "nonemployee compensation" or "box 1"
  const compensationMatch = text.match(
    /(?:box\s*1|nonemployee\s*compensation)[:\s]*\$?([\d,]+\.?\d*)/i
  );

  // Pattern 2: Look for standalone amounts that look like compensation (4+ digits)
  if (!compensationMatch || !parseAmount(compensationMatch[1])) {
    // Look for dollar amounts in the document
    const amounts = text.match(/\$\s*([\d,]+\.?\d{2})/g);
    if (amounts && amounts.length > 0) {
      // Take the largest amount as likely compensation
      const parsedAmounts = amounts
        .map((a) => parseAmount(a.replace('$', '')))
        .filter((a): a is number => a !== undefined && a > 0);
      if (parsedAmounts.length > 0) {
        result.nonemployeeCompensation = Math.max(...parsedAmounts);
      }
    }
  } else {
    result.nonemployeeCompensation = parseAmount(compensationMatch[1]);
  }

  // Box 4: Federal income tax withheld
  const fedWithheldMatch = text.match(
    /(?:box\s*4|federal.*tax\s*withheld)[:\s]*\$?([\d,]+\.?\d*)/i
  );
  if (fedWithheldMatch) result.federalWithheld = parseAmount(fedWithheldMatch[1]);

  // Payer name - look for company names before the TIN
  const payerMatch = text.match(/^([A-Z][A-Za-z0-9\s,&]+?)(?:\s*PAYER|\s*\d{2}-)/im);
  if (payerMatch) result.payer = payerMatch[1].trim();

  return result;
}

// Parse 1099-DIV from text
function parse1099DIV(text: string): Parsed1099DIV {
  const result: Parsed1099DIV = { documentType: '1099-div' };

  // Box 1a: Ordinary dividends
  const ordinaryMatch = text.match(
    /(?:box\s*1a|total\s*ordinary\s*dividends)[:\s]*\$?([\d,]+\.?\d*)/i
  );
  if (ordinaryMatch) result.ordinaryDividends = parseAmount(ordinaryMatch[1]);

  // Box 1b: Qualified dividends
  const qualifiedMatch = text.match(/(?:box\s*1b|qualified\s*dividends)[:\s]*\$?([\d,]+\.?\d*)/i);
  if (qualifiedMatch) result.qualifiedDividends = parseAmount(qualifiedMatch[1]);

  // Box 2a: Capital gain distributions
  const capitalMatch = text.match(/(?:box\s*2a|capital\s*gain)[:\s]*\$?([\d,]+\.?\d*)/i);
  if (capitalMatch) result.capitalGainDistributions = parseAmount(capitalMatch[1]);

  return result;
}

// Parse 1099-INT from text
function parse1099INT(text: string): Parsed1099INT {
  const result: Parsed1099INT = { documentType: '1099-int' };

  // Box 1: Interest income
  const interestMatch = text.match(/(?:box\s*1|interest\s*income)[:\s]*\$?([\d,]+\.?\d*)/i);
  if (interestMatch) result.interestIncome = parseAmount(interestMatch[1]);

  // Box 2: Early withdrawal penalty
  const penaltyMatch = text.match(
    /(?:box\s*2|early\s*withdrawal\s*penalty)[:\s]*\$?([\d,]+\.?\d*)/i
  );
  if (penaltyMatch) result.earlyWithdrawalPenalty = parseAmount(penaltyMatch[1]);

  return result;
}

// Parse receipt from text
function parseReceipt(text: string): ParsedReceipt {
  const result: ParsedReceipt = { documentType: 'receipt' };

  // Look for total amount - common patterns
  const totalMatch = text.match(
    /(?:total|amount\s*due|grand\s*total|subtotal)[:\s]*\$?([\d,]+\.?\d*)/i
  );
  if (totalMatch) result.amount = parseAmount(totalMatch[1]);

  // Look for date
  const dateMatch = text.match(/(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/);
  if (dateMatch) result.date = dateMatch[1];

  // Look for vendor name (usually at the top)
  const lines = text.split('\n').filter((l) => l.trim());
  if (lines.length > 0) {
    result.vendor = lines[0].trim().slice(0, 50);
  }

  return result;
}

// Detect document type from filename and content
function detectDocumentType(
  filename: string,
  text: string
): 'w2' | '1099-nec' | '1099-misc' | '1099-div' | '1099-int' | 'receipt' | 'unknown' {
  const lower = filename.toLowerCase();
  const textLower = text.toLowerCase();

  // Check filename first (most reliable)
  if (/1099-?nec/i.test(lower)) return '1099-nec';
  if (/1099-?misc/i.test(lower)) return '1099-misc';
  if (/1099-?div/i.test(lower)) return '1099-div';
  if (/1099-?int/i.test(lower)) return '1099-int';
  if (/w-?2/i.test(lower)) return 'w2';
  if (/receipt|expense|purchase/i.test(lower)) return 'receipt';

  // Check content - be specific with form numbers first (they're more reliable)
  if (/form\s*1099-?nec/i.test(textLower) || /1099-nec/i.test(textLower)) return '1099-nec';
  if (/form\s*1099-?misc/i.test(textLower)) return '1099-misc';
  if (/form\s*1099-?div/i.test(textLower)) return '1099-div';
  if (/form\s*1099-?int/i.test(textLower)) return '1099-int';
  if (/form\s*w-?2\b/i.test(textLower)) return 'w2';

  // Check content descriptions (less reliable, check after form numbers)
  if (/nonemployee\s*compensation/i.test(textLower)) return '1099-nec';
  if (/wage\s*and\s*tax\s*statement/i.test(textLower)) return 'w2';
  if (/miscellaneous\s*income/i.test(textLower)) return '1099-misc';
  if (/dividends\s*and\s*distributions/i.test(textLower)) return '1099-div';
  if (/interest\s*income/i.test(textLower)) return '1099-int';

  return 'unknown';
}

// Main parse function
export async function parsePdf(
  filePath: string,
  filename: string
): Promise<ParsedTaxDocument | null> {
  try {
    const text = await extractPdfText(filePath);
    console.log('Extracted PDF text:', text.slice(0, 500)); // Debug: show first 500 chars

    const docType = detectDocumentType(filename, text);
    console.log('Detected document type:', docType);

    let result: ParsedTaxDocument | null = null;

    switch (docType) {
      case 'w2':
        result = parseW2(text);
        break;
      case '1099-nec':
        result = parse1099NEC(text);
        break;
      case '1099-div':
        result = parse1099DIV(text);
        break;
      case '1099-int':
        result = parse1099INT(text);
        break;
      case 'receipt':
        result = parseReceipt(text);
        break;
      default:
        // Return basic receipt parsing as fallback
        result = parseReceipt(text);
    }

    console.log('Parse result:', result);
    return result;
  } catch (error) {
    console.error('PDF parsing error:', error);
    return null;
  }
}
