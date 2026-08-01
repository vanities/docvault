// Invoice PDF builder — renders a stored Invoice (line snapshots) through an
// InvoiceTemplate with pdf-lib, drawn from scratch. Row-work layout: one row
// per time entry (date · what was worked on · hours · rate · amount).
// All identity/terms content comes from the template (data, gitignored) —
// nothing personal is baked into the layout code.

import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'pdf-lib';
import type { Invoice, InvoiceTemplate } from './timesheet-store.js';
import { createLogger } from './logger.js';

const log = createLogger('Timesheet');

// US Letter
const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 54;

const COLS = {
  date: MARGIN,
  description: MARGIN + 68,
  hours: PAGE_W - MARGIN - 168,
  rate: PAGE_W - MARGIN - 112,
  amount: PAGE_W - MARGIN - 56,
};

const INK = rgb(0.12, 0.12, 0.14);
const MUTED = rgb(0.45, 0.45, 0.5);
const RULE = rgb(0.85, 0.85, 0.88);

function fmtMoney(value: number): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtHours(minutes: number): string {
  return (minutes / 60).toFixed(2);
}

/** Make a string safe for WinAnsi (Helvetica) encoding: collapse all
 * whitespace (multi-line Kimai descriptions carry \r\n) and replace any
 * character outside WinAnsi's Latin-1 + common-punctuation range. */
function sanitize(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/[^\x20-\x7E -ÿ–—‘’“”•…€]/g, '?')
    .trim();
}

/** Truncate `text` so it fits `maxWidth` at `size`, appending an ellipsis. */
function fit(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}…`, size) > maxWidth) {
    t = t.slice(0, -1);
  }
  return `${t}…`;
}

export async function buildInvoicePdf(
  invoice: Invoice,
  template?: InvoiceTemplate
): Promise<Uint8Array> {
  const t0 = performance.now();
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  const text = (
    p: PDFPage,
    str: string,
    x: number,
    yy: number,
    opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; rightAt?: number } = {}
  ) => {
    const f = opts.bold ? bold : font;
    const size = opts.size ?? 9;
    const x2 = opts.rightAt !== undefined ? opts.rightAt - f.widthOfTextAtSize(str, size) : x;
    p.drawText(str, { x: x2, y: yy, size, font: f, color: opts.color ?? INK });
  };

  const rule = (p: PDFPage, yy: number) => {
    p.drawLine({
      start: { x: MARGIN, y: yy },
      end: { x: PAGE_W - MARGIN, y: yy },
      thickness: 0.5,
      color: RULE,
    });
  };

  const tableHeader = (p: PDFPage, yy: number): number => {
    text(p, 'DATE', COLS.date, yy, { size: 7.5, bold: true, color: MUTED });
    text(p, 'DESCRIPTION', COLS.description, yy, { size: 7.5, bold: true, color: MUTED });
    text(p, 'HOURS', 0, yy, { size: 7.5, bold: true, color: MUTED, rightAt: COLS.hours + 40 });
    text(p, 'RATE', 0, yy, { size: 7.5, bold: true, color: MUTED, rightAt: COLS.rate + 40 });
    text(p, 'AMOUNT', 0, yy, { size: 7.5, bold: true, color: MUTED, rightAt: PAGE_W - MARGIN });
    rule(p, yy - 5);
    return yy - 19;
  };

  // ----- Header: title + invoice metadata (right-aligned) -----
  const title = sanitize(template?.title || 'Invoice').toUpperCase();
  text(page, title, MARGIN, y - 10, { size: 24, bold: true });
  text(page, `# ${sanitize(invoice.number)}`, 0, y, {
    size: 10,
    color: MUTED,
    rightAt: PAGE_W - MARGIN,
  });
  text(page, `Issued ${invoice.issueDate}`, 0, y - 14, {
    size: 10,
    color: MUTED,
    rightAt: PAGE_W - MARGIN,
  });
  text(page, `Due ${invoice.dueDate}`, 0, y - 28, {
    size: 10,
    color: MUTED,
    rightAt: PAGE_W - MARGIN,
  });
  y -= 52;

  // ----- Sender block from the template -----
  if (template) {
    text(page, 'FROM', MARGIN, y, { size: 7.5, bold: true, color: MUTED });
    y -= 13;
    text(page, sanitize(template.company), MARGIN, y, { size: 10.5, bold: true });
    y -= 13;
    for (const line of [...template.address, ...template.contact]) {
      const clean = sanitize(line);
      if (!clean) continue;
      text(page, clean, MARGIN, y, { size: 9 });
      y -= 12;
    }
    y -= 8;
  }

  text(page, 'BILL TO', MARGIN, y, { size: 7.5, bold: true, color: MUTED });
  y -= 13;
  text(page, sanitize(invoice.clientName), MARGIN, y, { size: 11, bold: true });
  y -= 28;

  // ----- Row-work table: one row per time entry -----
  y = tableHeader(page, y);
  for (const line of invoice.lines) {
    if (y < MARGIN + 80) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = tableHeader(page, PAGE_H - MARGIN);
    }
    const desc = sanitize(line.description) || sanitize(line.projectName);
    text(page, line.date, COLS.date, y, { size: 8.5, color: MUTED });
    text(
      page,
      fit(
        `${desc}  ·  ${sanitize(line.projectName)}`,
        font,
        8.5,
        COLS.hours - COLS.description - 10
      ),
      COLS.description,
      y,
      { size: 8.5 }
    );
    text(page, fmtHours(line.minutes), 0, y, { size: 8.5, rightAt: COLS.hours + 40 });
    text(page, fmtMoney(line.hourlyRate), 0, y, { size: 8.5, rightAt: COLS.rate + 40 });
    text(page, fmtMoney(line.amount), 0, y, { size: 8.5, rightAt: PAGE_W - MARGIN });
    y -= 14;
  }

  // ----- Totals -----
  if (y < MARGIN + 110) {
    page = doc.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - MARGIN;
  }
  rule(page, y + 6);
  y -= 10;
  text(page, `${fmtHours(invoice.totalMinutes)} hours`, 0, y, {
    size: 9,
    color: MUTED,
    rightAt: COLS.rate + 40,
  });
  if (invoice.vat > 0) {
    text(page, 'SUBTOTAL', COLS.hours - 60, y - 16, { size: 8.5, color: MUTED });
    text(page, fmtMoney(invoice.subtotal), 0, y - 16, { size: 9, rightAt: PAGE_W - MARGIN });
    text(page, `TAX (${invoice.vat}%)`, COLS.hours - 60, y - 30, { size: 8.5, color: MUTED });
    text(page, fmtMoney(invoice.tax), 0, y - 30, { size: 9, rightAt: PAGE_W - MARGIN });
    y -= 30;
  }
  text(page, `TOTAL (${invoice.currency})`, COLS.hours - 60, y - 18, { size: 9, bold: true });
  text(page, fmtMoney(invoice.total), 0, y - 18, {
    size: 12,
    bold: true,
    rightAt: PAGE_W - MARGIN,
  });
  y -= 40;

  // ----- Footer: payment terms + payment details from the template -----
  const footerLines: { str: string; bold?: boolean }[] = [];
  if (template?.paymentTerms) {
    footerLines.push({ str: `Payment terms: ${sanitize(template.paymentTerms)}` });
  }
  if (invoice.comment) footerLines.push({ str: sanitize(invoice.comment) });
  if (template && template.paymentDetails.length > 0) {
    footerLines.push({ str: 'PAYMENT DETAILS', bold: true });
    for (const line of template.paymentDetails) {
      const clean = sanitize(line);
      if (clean) footerLines.push({ str: clean });
    }
  }
  let fy = MARGIN + footerLines.length * 12;
  if (y < fy + 10) {
    page = doc.addPage([PAGE_W, PAGE_H]);
  }
  for (const line of footerLines) {
    text(page, line.str, MARGIN, fy, {
      size: line.bold ? 7.5 : 8,
      bold: line.bold,
      color: MUTED,
    });
    fy -= 12;
  }

  const bytes = await doc.save();
  log.info(
    `[invoice] rendered ${invoice.number}: ${invoice.lines.length} lines, ${doc.getPageCount()} page(s), ${bytes.length} bytes in ${(performance.now() - t0).toFixed(1)}ms`
  );
  return bytes;
}
