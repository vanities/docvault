// Verifies the invoice PDF carries the anchors bill-pay extractors key on
// (Mercury et al. read "Invoice #:", "Due Date:", "Amount Due:", "Pay to:"
// and PDF metadata; slash invoice numbers parse as dates). All fixture data
// is synthetic — nothing personal.

import { describe, expect, it } from 'vite-plus/test';
import { inflateSync } from 'node:zlib';
import { PDFDocument } from 'pdf-lib';
import { buildInvoicePdf, displayInvoiceNumber, invoiceParsedData } from './timesheet-invoice.js';
import type { Invoice, InvoiceTemplate } from './timesheet-store.js';

const template: InvoiceTemplate = {
  id: 'tpl-1',
  name: 'Acme',
  title: 'Invoice',
  company: 'Acme Consulting LLC',
  address: ['123 Main St', 'Springfield, ZZ 00000'],
  contact: ['John Doe', 'billing@example.com'],
  paymentTerms: 'Net 15',
  paymentDetails: ['Bank Routing #: 000000000', 'Bank Account #: 000000000'],
  dueDays: 15,
  vat: 0,
  descriptionStyle: 'wrap',
  archived: false,
};

const invoice: Invoice = {
  id: 'inv-1',
  number: '2026/024',
  clientId: 'client-1',
  clientName: 'Globex Corporation',
  issueDate: '2026-08-01',
  dueDate: '2026-08-15',
  status: 'new',
  currency: 'USD',
  totalMinutes: 600,
  subtotal: 1234.5,
  vat: 0,
  tax: 0,
  total: 1234.5,
  lines: [
    {
      date: '2026-07-01',
      description: 'Widget calibration',
      projectName: 'Widgets',
      minutes: 300,
      hourlyRate: 123.45,
      amount: 617.25,
    },
    {
      date: '2026-07-02',
      description: 'Widget deployment',
      projectName: 'Widgets',
      minutes: 300,
      hourlyRate: 123.45,
      amount: 617.25,
    },
  ],
  entryIds: [],
  createdAt: '2026-08-01T00:00:00.000Z',
};

/** Decompress every Flate content stream and decode the hex-encoded Tj text
 * runs (pdf-lib emits WinAnsi bytes as `<hex> Tj`) so drawn text is
 * searchable as plain strings. */
function extractStreamText(bytes: Uint8Array): string {
  const buf = Buffer.from(bytes);
  const chunks: string[] = [];
  let at = 0;
  for (;;) {
    const start = buf.indexOf('stream', at);
    if (start === -1) break;
    const dataStart = buf.indexOf('\n', start) + 1;
    const end = buf.indexOf('endstream', dataStart);
    if (end === -1) break;
    try {
      chunks.push(inflateSync(buf.subarray(dataStart, end)).toString('latin1'));
    } catch {
      // not a Flate stream — skip
    }
    at = end + 'endstream'.length;
  }
  return chunks
    .join('\n')
    .replace(/<([0-9A-Fa-f]+)>/g, (_, hex: string) => Buffer.from(hex, 'hex').toString('latin1'));
}

describe('displayInvoiceNumber', () => {
  it('replaces slashes with hyphens', () => {
    expect(displayInvoiceNumber('2026/024')).toBe('2026-024');
    expect(displayInvoiceNumber('2026-024')).toBe('2026-024');
  });
});

describe('buildInvoicePdf', () => {
  it('embeds payee metadata and extractor-friendly anchors', async () => {
    const bytes = await buildInvoicePdf(invoice, template);

    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(doc.getTitle()).toBe('Acme Consulting LLC — Invoice 2026-024');
    expect(doc.getAuthor()).toBe('Acme Consulting LLC');

    const text = extractStreamText(bytes);
    expect(text).toContain('Invoice #: 2026-024');
    expect(text).toContain('Invoice Date: 2026-08-01');
    expect(text).toContain('Due Date: 2026-08-15');
    expect(text).toContain('Amount Due: $1,234.50 (USD)');
    expect(text).toContain('Pay to: Acme Consulting LLC');
    // The raw slash form must not leak into the rendered page.
    expect(text).not.toContain('2026/024');
  });

  it('falls back to a bare title without a template', async () => {
    const bytes = await buildInvoicePdf(invoice);
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(doc.getTitle()).toBe('Invoice 2026-024');
    expect(doc.getAuthor()).toBeUndefined();
    expect(extractStreamText(bytes)).toContain('Amount Due: $1,234.50 (USD)');
  });
});

describe('invoiceParsedData', () => {
  it('carries the fields the analytics invoice extractor reads', () => {
    const entry = invoiceParsedData(invoice, template);
    // extractInvoice keys on documentType, then customer/amount/invoiceNumber.
    expect(entry.documentType).toBe('invoice');
    expect(entry.customer).toBe('Globex Corporation');
    expect(entry.amount).toBe(1234.5);
    expect(entry.invoiceNumber).toBe('2026/024');
    expect(entry.invoiceDate).toBe('2026-08-01');
    expect(entry.dueDate).toBe('2026-08-15');
    expect(entry.hours).toBe(10);
    expect(entry.vendor).toBe('Acme Consulting LLC');
    expect(entry.parsed).toBe(true);
    expect(entry.parsedBy).toBe('timesheet-auto-file');
  });

  it('omits vendor without a template', () => {
    const entry = invoiceParsedData(invoice);
    expect('vendor' in entry).toBe(false);
    expect(entry.amount).toBe(1234.5);
  });
});
