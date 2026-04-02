# Parser Refactoring Plan

## Current Architecture

The AI document parser (`POST /api/parse/:entity/:path`) uses a single generic prompt for all document types. It sends the document to an LLM and asks it to extract structured data. The response schema varies by document type, but the prompt is one-size-fits-all.

### Problems

1. **Overloaded prompt** — One prompt tries to handle W-2s, 1099s, bank statements, receipts, K-1s, 8949s, and more. Each has fundamentally different fields and layouts.
2. **Inconsistent output fields** — Bank statements return different field names depending on the bank (e.g., `deposits[]` vs `depositsAndAdditions[]` vs `transactions[]`). The financial-snapshot endpoint has to handle all variants.
3. **No structured outputs** — The parser relies on free-form LLM responses rather than constrained schemas. This causes field name drift and missing fields.
4. **No document type detection** — The parser doesn't identify the document type before parsing. It tries to extract everything at once.
5. **Bank statement variability** — Chase, Navy Federal, Amex, and other banks have wildly different statement formats. A single prompt can't optimize for all of them.
6. **Missing transaction-level data** — 1099-B/composite parsing only extracts summary totals. Individual transactions (sale dates, per-security proceeds/cost/gain) are lost.

## Proposed Architecture

### Phase 1: Document Type Detection

Add a lightweight classification step before parsing:

```
Document → [Type Detector] → "w2" | "1099-div" | "1099-composite" | "1099-nec" |
                               "1099-r" | "bank-statement" | "credit-card-statement" |
                               "receipt" | "k-1" | "8949" | "schedule-c" | "unknown"
```

- Use a simple LLM call with a short prompt: "What type of tax document is this?"
- Cache the detected type in `.docvault-parsed.json` alongside the parsed data
- Fall back to "unknown" → use generic parser

### Phase 2: Type-Specific Parsers

Each document type gets its own:

- **Prompt** — Optimized for that document's layout and fields
- **Output schema** — Strict TypeScript interface
- **Validation** — Post-parse checks (e.g., W-2 box totals should be consistent)

#### Parsers to Build

| Type                    | Schema                         | Structured Output? | Notes                                        |
| ----------------------- | ------------------------------ | ------------------ | -------------------------------------------- |
| `w2`                    | Fixed fields (boxes 1-20)      | Yes                | Well-defined, consistent format              |
| `1099-nec`              | 2-3 fields                     | Yes                | Simple                                       |
| `1099-div`              | ~15 fields                     | Yes                | Standard IRS layout                          |
| `1099-int`              | ~10 fields                     | Yes                | Standard IRS layout                          |
| `1099-r`                | ~15 fields                     | Yes                | Distribution codes matter                    |
| `1099-composite`        | DIV + INT + B sections         | Yes                | Needs per-transaction 1099-B data            |
| `1099-b` / `8949`       | Per-transaction array          | Yes                | Date sold, proceeds, cost, gain per security |
| `k-1`                   | ~20 boxes                      | Yes                | Partnership income, SE income, distributions |
| `schedule-c`            | Lines 1-31                     | Yes                | Business income/expenses                     |
| `bank-statement`        | Common schema                  | Partial            | See below                                    |
| `credit-card-statement` | Common schema                  | Partial            | Charges, payments, fees                      |
| `receipt`               | Vendor, amount, date, category | Yes                | Simple but variable layouts                  |

#### Bank Statement Strategy

Bank statements are the hardest because every bank has a different format. Strategy:

1. **Common output schema** — All bank statements produce the same structure:

   ```typescript
   interface ParsedBankStatement {
     bankName: string;
     accountType: string;
     accountNumberLast4: string;
     statementPeriod: { start: string; end: string };
     beginningBalance: number;
     endingBalance: number;
     totalDeposits: number;
     totalWithdrawals: number;
     deposits: Array<{
       date: string;
       description: string;
       amount: number;
       category?: 'revenue' | 'transfer' | 'refund' | 'other';
     }>;
     withdrawals: Array<{
       date: string;
       description: string;
       amount: number;
       category?: 'transfer' | 'payment' | 'fee' | 'other';
     }>;
   }
   ```

2. **Bank-specific prompt hints** — Detect the bank from the first page, then use a bank-specific prompt that knows the layout:
   - Chase Business: "Deposits and Additions" section, "CO Entry" ACH format
   - Navy Federal: Different layout, different terminology
   - Amex: Credit card statements (charges vs payments)

3. **Validation** — `beginningBalance + totalDeposits - totalWithdrawals ≈ endingBalance`

### Phase 3: Structured Outputs

Where possible, use the LLM's structured output mode (JSON schema enforcement):

- **OpenAI**: `response_format: { type: "json_schema", json_schema: {...} }`
- **Anthropic**: Tool use with strict input schema

This guarantees the response matches the TypeScript interface — no more field name drift.

### Phase 4: Enhanced 1099-Composite Parser

The current parser extracts:

```json
{
  "b": {
    "shortTermProceeds": 10558.9,
    "shortTermCostBasis": 8746.54,
    "shortTermGainLoss": 1812.36,
    "longTermProceeds": 163386.29,
    "longTermCostBasis": 68791.5,
    "longTermGainLoss": 94594.79
  }
}
```

The enhanced parser should extract per-transaction data:

```json
{
  "b": {
    "shortTerm": {
      "totalProceeds": 10558.9,
      "totalCostBasis": 8746.54,
      "totalGainLoss": 1812.36,
      "transactions": [
        {
          "security": "NVIDIA CORP",
          "symbol": "NVDA",
          "cusip": "67066G104",
          "dateSold": "09/11/25",
          "dateAcquired": "01/28/25",
          "quantity": 13.0,
          "proceeds": 2336.49,
          "costBasis": 1584.18,
          "gainLoss": 752.31,
          "term": "short",
          "boxCategory": "A"
        }
      ]
    },
    "longTerm": {
      /* same structure */
    }
  },
  "dividends": {
    "details": [
      {
        "security": "VNGRD S&P 500 ETF",
        "symbol": "VOO",
        "payments": [
          { "date": "03/31/25", "amount": 128.07, "type": "qualified" },
          { "date": "07/02/25", "amount": 123.31, "type": "qualified" }
        ]
      }
    ]
  }
}
```

This enables:

- Annualized method income allocation by date
- Per-security gain/loss reporting
- Dividend income timing for Form 2210

### Phase 5: Koinly 8949 Parser

Parse Koinly-generated Form 8949 PDFs:

```typescript
interface ParsedKoinly8949 {
  shortTerm: Array<{
    exchange: string; // "Coinbase", "Kraken", "Non-custodial"
    boxCategory: 'G' | 'H' | 'I';
    proceeds: number;
    costBasis: number;
    adjustment: number;
    gainLoss: number;
  }>;
  longTerm: Array<{
    exchange: string;
    boxCategory: 'J' | 'K' | 'L';
    proceeds: number;
    costBasis: number;
    adjustment: number;
    gainLoss: number;
  }>;
}
```

Also parse Koinly Schedule 1 for staking income:

```typescript
interface ParsedKoinlySchedule1 {
  digitalAssetIncome: number; // Line 8v
  otherIncome: Array<{ description: string; amount: number }>;
}
```

## Migration Plan

1. **Add `documentType` field** to parsed data — store the detected type
2. **Build type-specific parsers** one at a time (start with W-2, 1099-NEC as they're simplest)
3. **Add re-parse capability** — "re-parse with new parser" for existing documents
4. **Keep backward compatibility** — existing parsed data still works; new parsers produce cleaner output
5. **Update financial-snapshot** — Use new structured fields when available, fall back to old format

## File Structure

```
server/
  parsers/
    detect-type.ts        — Document type classification
    index.ts              — Parser registry and routing
    w2.ts                 — W-2 parser
    1099-nec.ts           — 1099-NEC parser
    1099-div.ts           — 1099-DIV parser
    1099-composite.ts     — 1099-Composite (DIV + INT + B) parser
    1099-r.ts             — 1099-R parser
    k1.ts                 — Schedule K-1 parser
    schedule-c.ts         — Schedule C parser
    bank-statement.ts     — Bank statement parser (multi-bank)
    credit-card.ts        — Credit card statement parser
    receipt.ts            — Receipt/expense parser
    koinly-8949.ts        — Koinly Form 8949 parser
    koinly-schedule.ts    — Koinly Schedule D / Schedule 1 parser
    generic.ts            — Fallback generic parser
  parsers/schemas/
    index.ts              — All TypeScript interfaces
```

## Testing Strategy

- Parse existing documents on NAS with new parsers
- Compare output to current `.docvault-parsed.json` entries
- Verify financial-snapshot endpoint still produces same results
- Add validation rules per document type (e.g., W-2 SS tax ≈ 6.2% of SS wages)
