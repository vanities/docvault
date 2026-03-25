// Invoice aggregation — builds InvoiceSummaryData from parsed documents.

import type { InvoiceItem, ParsedData, DocumentMetadata } from './types.js';
import type { FileInfo } from './income.js';
import { extractInvoice } from './extractors.js';

export interface InvoiceCustomerGroup {
  customer: string;
  total: number;
  count: number;
}

export interface InvoiceSummaryResult {
  invoiceTotal: number;
  invoiceCount: number;
  byCustomer: InvoiceCustomerGroup[];
  invoices: InvoiceItem[];
}

export function getInvoiceSummary(
  entityId: string,
  _year: string,
  parsedDataMap: Record<string, ParsedData>,
  metadataMap: Record<string, DocumentMetadata>,
  files: FileInfo[]
): InvoiceSummaryResult {
  const invoices: InvoiceItem[] = [];

  for (const file of files) {
    const parsedKey = `${entityId}/${file.path}`;
    const parsed = parsedDataMap[parsedKey];
    const meta = metadataMap[parsedKey];
    if (meta?.tracked === false) continue;
    if (!parsed) continue;

    const invoice = extractInvoice(parsed, file.name);
    if (invoice) {
      invoices.push({ ...invoice, filePath: file.path });
    }
  }

  // Group by customer
  const customerMap = new Map<string, { total: number; count: number }>();
  for (const inv of invoices) {
    const existing = customerMap.get(inv.customer) || { total: 0, count: 0 };
    customerMap.set(inv.customer, {
      total: existing.total + inv.amount,
      count: existing.count + 1,
    });
  }

  const byCustomer = Array.from(customerMap.entries())
    .map(([customer, { total, count }]) => ({ customer, total, count }))
    .sort((a, b) => b.total - a.total);

  return {
    invoiceTotal: byCustomer.reduce((s, g) => s + g.total, 0),
    invoiceCount: invoices.length,
    byCustomer,
    invoices,
  };
}
