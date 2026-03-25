// Retirement contribution aggregation.

import type { RetirementItem, ParsedData, DocumentMetadata } from './types.js';
import type { FileInfo } from './income.js';
import { extractRetirement } from './extractors.js';

export interface RetirementSummaryResult {
  totalContributions: number;
  employerContributions: number;
  employeeContributions: number;
  statementCount: number;
  byAccount: { institution: string; accountType: string; total: number }[];
}

export function getRetirementSummary(
  entityId: string,
  _year: string,
  parsedDataMap: Record<string, ParsedData>,
  metadataMap: Record<string, DocumentMetadata>,
  files: FileInfo[]
): RetirementSummaryResult | null {
  let totalEmployer = 0;
  let totalEmployee = 0;
  let totalContributions = 0;
  let count = 0;
  const accountMap = new Map<string, { institution: string; accountType: string; total: number }>();

  for (const file of files) {
    const parsedKey = `${entityId}/${file.path}`;
    const parsed = parsedDataMap[parsedKey];
    const meta = metadataMap[parsedKey];
    if (meta?.tracked === false) continue;
    if (!parsed) continue;

    // Also check if file is in a /retirement/ folder
    const isRetirementPath = file.path.toLowerCase().includes('/retirement/');
    const retirement = extractRetirement(parsed, file.name);

    if (retirement || isRetirementPath) {
      const employer = retirement?.employerContributions || 0;
      const employee = retirement?.employeeContributions || 0;
      const total = retirement?.totalContributions || employer + employee;

      if (total > 0) {
        totalEmployer += employer;
        totalEmployee += employee;
        totalContributions += total;
        count++;

        const institution = retirement?.institution || file.name.split('_')[0] || 'Unknown';
        const accountType = retirement?.accountType || 'Retirement';
        const key = `${institution}|${accountType}`;
        const existing = accountMap.get(key);
        if (existing) {
          existing.total += total;
        } else {
          accountMap.set(key, { institution, accountType, total });
        }
      }
    }
  }

  if (count === 0) return null;

  return {
    totalContributions,
    employerContributions: totalEmployer,
    employeeContributions: totalEmployee,
    statementCount: count,
    byAccount: Array.from(accountMap.values()),
  };
}
