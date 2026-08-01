// Invoice PDF builder — renders uninvoiced timesheet entries for one client
// into a generic invoice with pdf-lib (drawn from scratch; no template file).
// Deliberately unopinionated: sender block and notes are caller-supplied
// strings, nothing personal is baked into the layout.

import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'pdf-lib';
import { createLogger } from './logger.js';

const log = createLogger('Timesheet');

export interface InvoiceLine {
  date: string; // YYYY-MM-DD
  description: string;
  projectName: string;
  minutes: number;
  hourlyRate: number;
  amount: number;
}

export interface InvoiceInput {
  invoiceNumber: string;
  issueDate: string; // YYYY-MM-DD
  clientName: string;
  currency: string; // ISO code, used for the total label
  from?: string[]; // sender block lines (name, address, email…)
  notes?: string;
  lines: InvoiceLine[];
}

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
    .replace(/[^\x20-\x7E -ÿ–—‘’“”•…€]/g, '?')
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

export async function buildInvoicePdf(input: InvoiceInput): Promise<Uint8Array> {
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

  // ----- Header block -----
  text(page, 'INVOICE', MARGIN, y - 10, { size: 24, bold: true });
  text(page, `# ${sanitize(input.invoiceNumber)}`, 0, y - 8, {
    size: 10,
    color: MUTED,
    rightAt: PAGE_W - MARGIN,
  });
  text(page, `Issued ${input.issueDate}`, 0, y - 22, {
    size: 10,
    color: MUTED,
    rightAt: PAGE_W - MARGIN,
  });
  y -= 46;

  // Sender block (optional, caller-supplied)
  if (input.from && input.from.length > 0) {
    text(page, 'FROM', MARGIN, y, { size: 7.5, bold: true, color: MUTED });
    y -= 13;
    for (const line of input.from) {
      text(page, sanitize(line), MARGIN, y, { size: 9.5 });
      y -= 12;
    }
    y -= 6;
  }

  text(page, 'BILL TO', MARGIN, y, { size: 7.5, bold: true, color: MUTED });
  y -= 13;
  text(page, sanitize(input.clientName), MARGIN, y, { size: 11, bold: true });
  y -= 28;

  // ----- Line table -----
  y = tableHeader(page, y);
  for (const line of input.lines) {
    if (y < MARGIN + 60) {
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
  if (y < MARGIN + 60) {
    page = doc.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - MARGIN;
  }
  rule(page, y + 6);
  y -= 10;
  const totalMinutes = input.lines.reduce((s, l) => s + l.minutes, 0);
  const totalAmount = input.lines.reduce((s, l) => s + l.amount, 0);
  text(page, `${fmtHours(totalMinutes)} hours`, 0, y, {
    size: 9,
    color: MUTED,
    rightAt: COLS.rate + 40,
  });
  text(page, `TOTAL (${input.currency})`, COLS.hours - 60, y - 18, { size: 9, bold: true });
  text(page, fmtMoney(totalAmount), 0, y - 18, { size: 12, bold: true, rightAt: PAGE_W - MARGIN });

  if (input.notes) {
    text(page, sanitize(input.notes), MARGIN, MARGIN - 14, { size: 8, color: MUTED });
  }

  const bytes = await doc.save();
  log.info(
    `[invoice] rendered ${input.lines.length} lines, ${doc.getPageCount()} page(s), ${bytes.length} bytes in ${(performance.now() - t0).toFixed(1)}ms`
  );
  return bytes;
}
