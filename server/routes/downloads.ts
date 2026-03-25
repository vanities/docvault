// Download route handlers — zip and CPA package exports.
// Extracted from server/index.ts.

import { promises as fs } from 'fs';
import path from 'path';
import { zipSync } from 'fflate';
import {
  DATA_DIR,
  loadConfig,
  loadParsedData,
  loadMetadata,
  loadSalesData,
  loadMileageData,
  loadContributions,
  getEntityPath,
  scanDirectory,
  jsonResponse,
  corsHeaders,
} from '../data.js';
import type { EntityConfig, FileInfo, ParsedData, Contribution401k } from '../data.js';

export async function handleDownloadRoutes(
  req: Request,
  url: URL,
  pathname: string
): Promise<Response | null> {
  // POST /api/download/zip - Download filtered files as a zip archive
  if (pathname === '/api/download/zip' && req.method === 'POST') {
    try {
      const body = await req.json();
      const {
        entity: entityId,
        year,
        filter,
      } = body as {
        entity: string;
        year: string;
        filter: 'income' | 'expenses' | 'invoices' | 'all';
      };

      if (!entityId || !year) {
        return jsonResponse({ error: 'Missing entity or year' }, 400);
      }

      const entityPath = await getEntityPath(entityId);
      if (!entityPath) {
        return jsonResponse({ error: 'Entity not found' }, 404);
      }

      const yearPath = path.join(entityPath, year);
      let files: FileInfo[] = [];
      try {
        await fs.access(yearPath);
        files = await scanDirectory(yearPath, year);
      } catch {
        return jsonResponse({ error: 'Year directory not found' }, 404);
      }

      // Filter out untracked files
      const metadataMap = await loadMetadata();
      files = files.filter((file) => {
        const metaKey = `${entityId}/${file.path}`;
        const meta = metadataMap[metaKey];
        return meta?.tracked !== false;
      });

      // Filter files based on the requested category
      if (filter && filter !== 'all') {
        files = files.filter((file) => {
          const fileLower = file.path.toLowerCase();
          switch (filter) {
            case 'income':
              return fileLower.includes('/income/w2/') || fileLower.includes('/income/1099/');
            case 'expenses':
              return fileLower.includes('/expenses/');
            case 'invoices':
              return fileLower.includes('/income/other/');
            default:
              return true;
          }
        });
      }

      if (files.length === 0) {
        return jsonResponse({ error: 'No files match the filter' }, 404);
      }

      // Read all files and build zip data
      const zipData: Record<string, Uint8Array> = {};
      for (const file of files) {
        const fullPath = path.join(entityPath, file.path);
        try {
          const content = await fs.readFile(fullPath);
          // Use the relative path within the year as the zip entry name
          zipData[file.path] = new Uint8Array(content);
        } catch {
          console.error(`[Zip] Failed to read ${file.path}`);
        }
      }

      const zipped = zipSync(zipData);
      const filterLabel = filter || 'all';
      const filename = `${entityId}_${year}_${filterLabel}.zip`;

      return new Response(zipped, {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Content-Length': String(zipped.length),
          ...corsHeaders(),
        },
      });
    } catch (err) {
      return jsonResponse({ error: 'Failed to create zip', details: String(err) }, 500);
    }
  }

  // POST /api/download/cpa-package - Download CPA-ready zip with TAX_SUMMARY.txt manifest
  if (pathname === '/api/download/cpa-package' && req.method === 'POST') {
    try {
      const body = await req.json();
      const { entity: entityId, year } = body as { entity: string; year: number };

      if (!entityId || !year) {
        return jsonResponse({ error: 'Missing entity or year' }, 400);
      }

      const entityPath = await getEntityPath(entityId);
      if (!entityPath) {
        return jsonResponse({ error: 'Entity not found' }, 404);
      }

      const yearStr = String(year);
      const yearPath = path.join(entityPath, yearStr);
      let files: FileInfo[] = [];
      try {
        await fs.access(yearPath);
        files = await scanDirectory(yearPath, yearStr);
      } catch {
        return jsonResponse({ error: 'Year directory not found' }, 404);
      }

      // Filter out untracked files
      const metadataMap = await loadMetadata();
      files = files.filter((file) => {
        const metaKey = `${entityId}/${file.path}`;
        const meta = metadataMap[metaKey];
        return meta?.tracked !== false;
      });

      if (files.length === 0) {
        return jsonResponse({ error: 'No tracked files found' }, 404);
      }

      // Load parsed data for manifest generation
      const parsedDataMap = await loadParsedData();

      // Build TAX_SUMMARY.txt manifest
      const lines: string[] = [];
      lines.push('='.repeat(60));
      lines.push(`TAX SUMMARY — ${entityId.toUpperCase()} — ${year}`);
      lines.push(`Generated: ${new Date().toISOString().split('T')[0]}`);
      lines.push('='.repeat(60));
      lines.push('');

      // --- Income Section ---
      const w2Files = files.filter((f) => f.path.toLowerCase().includes('/income/w2/'));
      const f1099Files = files.filter((f) => f.path.toLowerCase().includes('/income/1099/'));
      lines.push('INCOME');
      lines.push('-'.repeat(40));

      let totalW2 = 0;
      if (w2Files.length > 0) {
        lines.push('  W-2 Wages:');
        for (const f of w2Files) {
          const key = `${entityId}/${f.path}`;
          const pd = parsedDataMap[key] as Record<string, unknown> | undefined;
          const employer = (pd?.employerName || pd?.employer || f.name.split('_')[0]) as string;
          const wages = Number(pd?.wages || 0);
          totalW2 += wages;
          lines.push(
            `    ${employer}: $${wages.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
          );
        }
      }

      let total1099 = 0;
      let totalCapitalGains = 0;
      const capitalGainsEntries: {
        payer: string;
        total: number;
        shortTerm: number;
        longTerm: number;
      }[] = [];

      if (f1099Files.length > 0) {
        lines.push('  1099 Income:');
        for (const f of f1099Files) {
          const key = `${entityId}/${f.path}`;
          const pd = parsedDataMap[key] as Record<string, unknown> | undefined;
          const payer = (pd?.payerName || pd?.payer || f.name.split('_')[0]) as string;
          const docType = (pd?.documentType || '') as string;

          if (docType === '1099-composite') {
            // Composite: extract dividend/interest income (not capital gains)
            const div = pd?.div as Record<string, number> | undefined;
            const int = pd?.int as Record<string, number> | undefined;
            const b = pd?.b as Record<string, number> | undefined;
            const misc = pd?.misc as Record<string, number> | undefined;
            const divIncome = Number(div?.ordinaryDividends || pd?.totalDividendIncome || 0);
            const intIncome = Number(int?.interestIncome || pd?.totalInterestIncome || 0);
            const miscIncome =
              Number(misc?.rents || 0) +
              Number(misc?.royalties || 0) +
              Number(misc?.otherIncome || 0);
            if (divIncome > 0) {
              total1099 += divIncome;
              lines.push(
                `    ${payer} (1099-DIV): $${divIncome.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
              );
            }
            if (intIncome > 0) {
              total1099 += intIncome;
              lines.push(
                `    ${payer} (1099-INT): $${intIncome.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
              );
            }
            if (miscIncome > 0) {
              total1099 += miscIncome;
              lines.push(
                `    ${payer} (1099-MISC): $${miscIncome.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
              );
            }
            // Track capital gains separately
            if (b) {
              const st = Number(b.shortTermGainLoss || 0);
              const lt = Number(b.longTermGainLoss || 0);
              const total = Number(b.totalGainLoss || pd?.totalCapitalGains || st + lt);
              totalCapitalGains += total;
              capitalGainsEntries.push({ payer, total, shortTerm: st, longTerm: lt });
            }
          } else if (docType === '1099-b') {
            // Standalone 1099-B: capital gains only, NOT income
            const st = Number(pd?.shortTermGainLoss || 0);
            const lt = Number(pd?.longTermGainLoss || 0);
            const total = Number(pd?.totalGainLoss || st + lt);
            totalCapitalGains += total;
            capitalGainsEntries.push({ payer, total, shortTerm: st, longTerm: lt });
          } else {
            // Regular 1099s (NEC, MISC, DIV, INT, R)
            const amount = Number(
              pd?.nonemployeeCompensation ||
                pd?.amount ||
                pd?.ordinaryDividends ||
                pd?.interestIncome ||
                0
            );
            total1099 += amount;
            lines.push(
              `    ${payer}: $${amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
            );
          }
        }
      }

      const totalIncome = totalW2 + total1099;
      lines.push(
        `  TOTAL INCOME: $${totalIncome.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
      );
      lines.push('');

      // --- Capital Gains (Schedule D) Section ---
      if (capitalGainsEntries.length > 0) {
        lines.push('CAPITAL GAINS (Schedule D)');
        lines.push('-'.repeat(40));
        for (const entry of capitalGainsEntries) {
          lines.push(
            `  ${entry.payer}: $${entry.total.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
          );
          if (entry.shortTerm !== 0) {
            lines.push(
              `    Short-term: $${entry.shortTerm.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
            );
          }
          if (entry.longTerm !== 0) {
            lines.push(
              `    Long-term: $${entry.longTerm.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
            );
          }
        }
        lines.push(
          `  TOTAL NET CAPITAL GAINS: $${totalCapitalGains.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
        );
        lines.push('');
      }

      // --- Mortgage Interest (1098) Section ---
      const f1098Files = files.filter(
        (f) =>
          f.path.toLowerCase().includes('/expenses/1098/') ||
          f.path.toLowerCase().includes('/income/1098/')
      );
      if (f1098Files.length > 0) {
        lines.push('MORTGAGE INTEREST (1098)');
        lines.push('-'.repeat(40));
        let totalMortgageInterest = 0;
        for (const f of f1098Files) {
          const key = `${entityId}/${f.path}`;
          const pd = parsedDataMap[key] as Record<string, unknown> | undefined;
          const lender = (pd?.lender || pd?.institution || f.name.split('_')[0]) as string;
          const interest = Number(pd?.mortgageInterest || 0);
          totalMortgageInterest += interest;
          lines.push(
            `  ${lender}: $${interest.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
          );
        }
        if (totalMortgageInterest > 0) {
          lines.push(
            `  TOTAL MORTGAGE INTEREST PAID: $${totalMortgageInterest.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
          );
        }
        lines.push('');
      }

      // --- Retirement Contributions Section ---
      const retirementFiles = files.filter((f) => f.path.toLowerCase().includes('/retirement/'));
      if (retirementFiles.length > 0) {
        lines.push('RETIREMENT CONTRIBUTIONS');
        lines.push('-'.repeat(40));
        let totalRetirement = 0;
        for (const f of retirementFiles) {
          const key = `${entityId}/${f.path}`;
          const pd = parsedDataMap[key] as Record<string, unknown> | undefined;
          const institution = (pd?.institution || f.name.split('_')[0]) as string;
          const accountType = (pd?.accountType || 'Retirement Account') as string;
          const employer = Number(pd?.employerContributions || 0);
          const employee = Number(pd?.employeeContributions || 0);
          const total = Number(pd?.totalContributions || employer + employee);
          totalRetirement += total;
          lines.push(`  ${institution} (${accountType}):`);
          if (employer > 0)
            lines.push(
              `    Employer: $${employer.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
            );
          if (employee > 0)
            lines.push(
              `    Employee: $${employee.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
            );
          lines.push(`    Total: $${total.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
        }
        if (totalRetirement > 0) {
          lines.push(
            `  TOTAL RETIREMENT CONTRIBUTIONS: $${totalRetirement.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
          );
        }
        lines.push('');
      }

      // --- Invoices Section ---
      const invoiceFiles = files.filter((f) => {
        const key = `${entityId}/${f.path}`;
        const pd = parsedDataMap[key] as Record<string, unknown> | undefined;
        return pd?.documentType === 'invoice' || f.name.toLowerCase().includes('invoice');
      });

      if (invoiceFiles.length > 0) {
        lines.push('INVOICED REVENUE');
        lines.push('-'.repeat(40));
        const customerTotals = new Map<string, number>();
        for (const f of invoiceFiles) {
          const key = `${entityId}/${f.path}`;
          const pd = parsedDataMap[key] as Record<string, unknown> | undefined;
          const customer = (pd?.billTo ||
            pd?.customerName ||
            pd?.vendor ||
            f.name.split('_')[0]) as string;
          const amount = Number(pd?.totalAmount || pd?.amount || pd?.total || pd?.subtotal || 0);
          customerTotals.set(customer, (customerTotals.get(customer) || 0) + amount);
        }
        let invoiceTotal = 0;
        for (const [customer, total] of customerTotals) {
          invoiceTotal += total;
          lines.push(
            `  ${customer}: $${total.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
          );
        }
        lines.push(
          `  TOTAL INVOICED: $${invoiceTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
        );
        lines.push('');
      }

      // --- Expenses Section ---
      const expenseFiles = files.filter((f) => f.path.toLowerCase().includes('/expenses/'));
      if (expenseFiles.length > 0) {
        lines.push('EXPENSES');
        lines.push('-'.repeat(40));
        const categoryTotals = new Map<string, number>();
        for (const f of expenseFiles) {
          const key = `${entityId}/${f.path}`;
          const pd = parsedDataMap[key] as Record<string, unknown> | undefined;
          const category = (pd?.category || 'other') as string;
          const amount = Number(pd?.totalAmount || pd?.amount || pd?.total || 0);
          categoryTotals.set(category, (categoryTotals.get(category) || 0) + amount);
        }
        let expenseTotal = 0;
        for (const [category, total] of categoryTotals) {
          expenseTotal += total;
          lines.push(
            `  ${category}: $${total.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
          );
        }
        lines.push(
          `  TOTAL EXPENSES: $${expenseTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
        );
        lines.push('');
      }

      // --- Statements Section ---
      const statementFiles = files.filter((f) => f.path.toLowerCase().includes('/statements/'));
      if (statementFiles.length > 0) {
        lines.push('STATEMENTS');
        lines.push('-'.repeat(40));
        for (const f of statementFiles) {
          lines.push(`  ${f.name}`);
        }
        lines.push('');
      }

      // --- Document Inventory ---
      lines.push('DOCUMENT INVENTORY');
      lines.push('-'.repeat(40));
      for (const f of files) {
        lines.push(`  ${f.path}`);
      }
      lines.push('');
      lines.push(`Total files: ${files.length}`);

      const manifest = lines.join('\n');

      // Build zip with CPA-relevant files + manifest
      // Exclude individual receipt/expense files — the parsed summary in
      // TAX_SUMMARY.txt is sufficient. CPAs need tax forms, statements,
      // invoices, and retirement docs — not receipt screenshots.
      const zipData: Record<string, Uint8Array> = {};
      zipData['TAX_SUMMARY.txt'] = new TextEncoder().encode(manifest);

      const isReceiptFile = (filePath: string): boolean => {
        const lower = filePath.toLowerCase();
        // Expense files in business/ subfolder are receipts
        if (lower.includes('/expenses/business/')) return true;
        // Expense files that are receipts (not 1098s or equipment contracts)
        if (
          lower.includes('/expenses/') &&
          !lower.includes('/1098/') &&
          !lower.includes('/equipment/')
        )
          return true;
        return false;
      };

      for (const file of files) {
        if (isReceiptFile(file.path)) continue; // Skip receipt files
        const fullPath = path.join(entityPath, file.path);
        try {
          const content = await fs.readFile(fullPath);
          zipData[file.path] = new Uint8Array(content);
        } catch {
          console.error(`[CPA Package] Failed to read ${file.path}`);
        }
      }

      const zipped = zipSync(zipData);
      const filename = `${entityId}_${year}_CPA_Package.zip`;

      return new Response(zipped, {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Content-Length': String(zipped.length),
          ...corsHeaders(),
        },
      });
    } catch (err) {
      return jsonResponse({ error: 'Failed to create CPA package', details: String(err) }, 500);
    }
  }
  return null;
}
