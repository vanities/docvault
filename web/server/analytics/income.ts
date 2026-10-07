// Income aggregation — builds IncomeSummary from parsed documents for an entity/year.

import type { IncomeItem, ParsedData, DocumentMetadata } from './types.js';
import { extractAllIncome } from './extractors.js';

export interface FileInfo {
  name: string;
  path: string; // relative to entity dir, e.g. "2025/income/w2/file.pdf"
  type: string;
}

export interface IncomeSummaryResult {
  w2Total: number;
  w2Count: number;
  income1099Total: number;
  income1099Count: number;
  k1Total: number;
  k1Count: number;
  capitalGainsShortTerm: number;
  capitalGainsLongTerm: number;
  capitalGainsTotal: number;
  federalWithheld: number;
  stateWithheld: number;
  totalIncome: number;
  items: IncomeItem[];
}

export function getIncomeSummary(
  entityId: string,
  _year: string,
  parsedDataMap: Record<string, ParsedData>,
  metadataMap: Record<string, DocumentMetadata>,
  files: FileInfo[]
): IncomeSummaryResult {
  const items: IncomeItem[] = [];

  for (const file of files) {
    const parsedKey = `${entityId}/${file.path}`;
    const parsed = parsedDataMap[parsedKey];
    const meta = metadataMap[parsedKey];
    if (meta?.tracked === false) continue;
    if (!parsed) continue;

    const extracted = extractAllIncome(parsed, file.name);
    for (const item of extracted) {
      items.push({ ...item, filePath: file.path });
    }
  }

  // Aggregate
  let w2Total = 0,
    w2Count = 0,
    income1099Total = 0,
    income1099Count = 0,
    k1Total = 0,
    k1Count = 0,
    capitalGainsST = 0,
    capitalGainsLT = 0,
    federalWithheld = 0,
    stateWithheld = 0;

  for (const item of items) {
    switch (item.type) {
      case 'W-2':
        w2Total += item.amount;
        w2Count++;
        federalWithheld += (item.details?.federalWithheld as number) || 0;
        stateWithheld += (item.details?.stateWithheld as number) || 0;
        break;
      case '1099-NEC':
      case '1099-MISC':
        income1099Total += item.amount;
        income1099Count++;
        break;
      case '1099-DIV':
      case '1099-INT':
        income1099Total += item.amount;
        income1099Count++;
        federalWithheld += (item.details?.federalWithheld as number) || 0;
        break;
      case '1099-R':
        // 1099-R distributions tracked separately — taxation depends on distribution code
        // Don't add to income1099Total (which is Schedule C / investment income)
        income1099Count++;
        federalWithheld += (item.details?.federalWithheld as number) || 0;
        break;
      case '1099-B':
        capitalGainsST += (item.details?.shortTermGainLoss as number) || 0;
        capitalGainsLT += (item.details?.longTermGainLoss as number) || 0;
        break;
      case 'K-1':
        k1Total += item.amount;
        k1Count++;
        break;
    }
  }

  const capitalGainsTotal = capitalGainsST + capitalGainsLT;
  const totalIncome = w2Total + income1099Total + k1Total + capitalGainsTotal;

  return {
    w2Total,
    w2Count,
    income1099Total,
    income1099Count,
    k1Total,
    k1Count,
    capitalGainsShortTerm: capitalGainsST,
    capitalGainsLongTerm: capitalGainsLT,
    capitalGainsTotal,
    federalWithheld,
    stateWithheld,
    totalIncome,
    items,
  };
}
