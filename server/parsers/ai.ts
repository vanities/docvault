import { promises as fs } from 'fs';
import Anthropic from '@anthropic-ai/sdk';
import type { ParsedTaxDocument } from './pdf.js';
import { getAnthropicKey } from '../index.js';

// Create client lazily to pick up API key from settings
let client: Anthropic | null = null;

async function getClient(): Promise<Anthropic> {
  const apiKey = await getAnthropicKey();
  if (!apiKey) {
    throw new Error('Anthropic API key not configured. Please add it in Settings.');
  }
  // Recreate client if key changed
  client = new Anthropic({ apiKey });
  return client;
}

// System prompt for tax document parsing
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

For receipts, extract:
- vendor: Store/business name
- vendorAddress: Full address if shown
- amount: Total amount paid
- subtotal: Subtotal before tax
- tax: Tax amount
- date: Date of purchase (YYYY-MM-DD format)
- paymentMethod: Cash, credit card, etc.
- lastFourCard: Last 4 digits of card if shown
- items: Array of {description, quantity, price} for line items
- category: One of: meals, software, equipment, childcare, medical, travel, office, other

IMPORTANT: Extract ALL data visible on the document. Include every field that has a value. Respond ONLY with a valid JSON object. All monetary values should be numbers (not strings). If a field is empty or not found, omit it.`;

// Map MIME type to Anthropic's expected media type
function getMediaType(
  mimeType: string
): 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' | 'application/pdf' {
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return 'image/jpeg';
  if (mimeType.includes('png')) return 'image/png';
  if (mimeType.includes('gif')) return 'image/gif';
  if (mimeType.includes('webp')) return 'image/webp';
  if (mimeType.includes('pdf')) return 'application/pdf';
  return 'image/jpeg'; // Default fallback
}

// Detect document type from filename
function detectDocumentType(filename: string): string {
  const lower = filename.toLowerCase();
  if (/1099-?nec/i.test(lower)) return '1099-NEC';
  if (/1099-?misc/i.test(lower)) return '1099-MISC';
  if (/1099-?div/i.test(lower)) return '1099-DIV';
  if (/1099-?int/i.test(lower)) return '1099-INT';
  if (/w-?2/i.test(lower)) return 'W-2';
  if (/receipt|expense|purchase/i.test(lower)) return 'receipt';
  return 'unknown';
}

// Parse document using Claude Vision API
export async function parseWithAI(
  filePath: string,
  filename: string
): Promise<ParsedTaxDocument | null> {
  try {
    // Read file as base64
    const buffer = await fs.readFile(filePath);
    const base64Data = buffer.toString('base64');

    // Determine file type
    const ext = filename.split('.').pop()?.toLowerCase();
    let mimeType = 'application/pdf';
    if (ext === 'png') mimeType = 'image/png';
    else if (ext === 'jpg' || ext === 'jpeg') mimeType = 'image/jpeg';
    else if (ext === 'gif') mimeType = 'image/gif';
    else if (ext === 'webp') mimeType = 'image/webp';

    // Detect document type from filename
    const docTypeHint = detectDocumentType(filename);

    // Build user prompt
    let userPrompt = 'Parse this tax document and extract all relevant data as JSON.';
    if (docTypeHint !== 'unknown') {
      userPrompt = `This appears to be a ${docTypeHint} form. Parse it and extract all relevant data as JSON.`;
    }

    console.log(`[AI Parser] Parsing ${filename} (detected: ${docTypeHint})`);

    // Get client (will throw if no API key)
    const anthropic = await getClient();

    // Build content based on file type
    const isPdf = mimeType === 'application/pdf';

    const fileContent = isPdf
      ? {
          type: 'document' as const,
          source: {
            type: 'base64' as const,
            media_type: 'application/pdf' as const,
            data: base64Data,
          },
        }
      : {
          type: 'image' as const,
          source: {
            type: 'base64' as const,
            media_type: getMediaType(mimeType),
            data: base64Data,
          },
        };

    // Call Claude Vision API
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            fileContent,
            {
              type: 'text',
              text: userPrompt,
            },
          ],
        },
      ],
    });

    // Extract text response
    const textContent = response.content.find((c) => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      console.error('[AI Parser] No text response from Claude');
      return null;
    }

    console.log('[AI Parser] Raw response:', textContent.text);

    // Parse JSON from response
    // Claude might wrap JSON in markdown code blocks
    let jsonStr = textContent.text;
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    }

    const parsed = JSON.parse(jsonStr);

    // Add document type
    let documentType: ParsedTaxDocument['documentType'];
    if (parsed.documentType) {
      documentType = parsed.documentType;
    } else if (docTypeHint === 'W-2') {
      documentType = 'w2';
    } else if (docTypeHint === '1099-NEC') {
      documentType = '1099-nec';
    } else if (docTypeHint === '1099-MISC') {
      documentType = '1099-misc';
    } else if (docTypeHint === '1099-DIV') {
      documentType = '1099-div';
    } else if (docTypeHint === '1099-INT') {
      documentType = '1099-int';
    } else if (docTypeHint === 'receipt') {
      documentType = 'receipt';
    } else {
      // Try to detect from parsed content
      if (parsed.wages !== undefined || parsed.employer !== undefined) {
        documentType = 'w2';
      } else if (parsed.nonemployeeCompensation !== undefined) {
        documentType = '1099-nec';
      } else if (parsed.rents !== undefined || parsed.royalties !== undefined) {
        documentType = '1099-misc';
      } else if (parsed.ordinaryDividends !== undefined) {
        documentType = '1099-div';
      } else if (parsed.interestIncome !== undefined) {
        documentType = '1099-int';
      } else {
        documentType = 'receipt';
      }
    }

    // Return all parsed fields with the document type
    // Spread all parsed fields to capture everything the AI extracted
    return {
      ...parsed,
      documentType,
    } as ParsedTaxDocument;
  } catch (error) {
    console.error('[AI Parser] Error:', error);
    return null;
  }
}
