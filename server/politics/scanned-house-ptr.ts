// Scanned/paper House PTR recovery — reads the hand-filed Periodic Transaction
// Report *form* that flat OCR cannot. These filings are a fixed checkbox grid:
// the transaction TYPE (Purchase/Sale/Exchange) and the AMOUNT band are an "X"
// in one of a row of ruled cells, NOT text — so `pdftotext`/`tesseract --psm 6`
// recover nothing parseable (see house-ptr.ts's needs-attention fallback).
//
// The strategy that DOES work, split into two layers so the hard interpretation
// logic is pure + unit-testable:
//
//   1. EXTRACTION (impure, env-dependent): rasterize each page (`pdftoppm -gray`
//      → PGM, trivially parseable raw grayscale), auto-detect the table's ruled
//      lines by projecting darkness onto each axis (gridlines = peaks), then for
//      every transaction row record (a) the OCR'd asset/owner text, (b) per-cell
//      OCR of the date columns with a digit whitelist, and (c) the dark-pixel
//      count of each TYPE and AMOUNT cell. The result is a `ScanObservation`.
//   2. INTERPRETATION (pure): turn a `ScanObservation` into TradeRecords — the
//      checked cell is argmax(darkness) with a confidence margin; the ticker is
//      the trailing "- XXX" token the filer wrote; dates are MM/DD/YY → ISO.
//
// Freezing a real filing's `ScanObservation` as a fixture lets us golden-test the
// interpretation deterministically without poppler/tesseract in CI. Congressional
// disclosures are public/non-personal, so fixtures are safe to commit.

import { execFile } from 'child_process';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import { createLogger } from '../logger.js';
import { parseDisclosureAmountRange } from './trade-transform.js';
import type { TradeCategory, TradeRecord } from './types.js';

const execFileAsync = promisify(execFile);
const log = createLogger('PoliticsScannedHouse');

const PDFTOPPM = process.env.PDFTOPPM_BIN ?? 'pdftoppm';
const TESSERACT = process.env.TESSERACT_BIN ?? 'tesseract';

// Standard House PTR amount bands, columns A–J left→right. Kept identical to the
// strings the e-filed parser emits so scanned + e-filed trades read consistently.
export const HOUSE_AMOUNT_RANGES: readonly string[] = [
  '$1,001 - $15,000',
  '$15,001 - $50,000',
  '$50,001 - $100,000',
  '$100,001 - $250,000',
  '$250,001 - $500,000',
  '$500,001 - $1,000,000',
  '$1,000,001 - $5,000,000',
  '$5,000,001 - $25,000,000',
  '$25,000,001 - $50,000,000',
  'Over $50,000,000',
];

// ---------------------------------------------------------------------------
// Observation shape (the frozen-fixture boundary between extract & interpret)
// ---------------------------------------------------------------------------

export interface ScanRowObservation {
  /** Owner code OCR'd from the leftmost cell (JT/SP/DC), if any. */
  ownerText: string | null;
  /** Full asset-name text OCR'd from the asset column (incl. trailing "- TICKER"). */
  assetText: string;
  /** Per-cell digit-whitelisted OCR of the trade-date cell ("MM/DD/YY"). */
  tradeDateText: string | null;
  /** Per-cell digit-whitelisted OCR of the notification-date cell. */
  notifiedDateText: string | null;
  /** Dark-pixel count of each TYPE cell interior — [Purchase, Sale, Exchange]. */
  typeDark: number[];
  /** Dark-pixel count of each AMOUNT cell interior — [A..J], length 10. */
  amountDark: number[];
}

export interface ScanObservation {
  rows: ScanRowObservation[];
}

export interface ScannedHouseContext {
  docId: string;
  filingYear: number;
  filingDate: string | null;
  filerName: string;
  filingUrl: string;
}

// ---------------------------------------------------------------------------
// Pure interpretation — ScanObservation → TradeRecord[]  (unit-tested)
// ---------------------------------------------------------------------------

/** Index of the checked cell: the darkest interior, but only if it clearly beats
 *  the runner-up (margin) and clears an absolute floor. Hand-drawn X's are dense;
 *  empty interiors are near-zero. Ambiguous → null (caller leaves the field blank
 *  rather than guess). */
export function pickCheckedCell(
  counts: number[],
  opts: { minAbs?: number; ratio?: number } = {}
): number | null {
  const minAbs = opts.minAbs ?? 70;
  const ratio = opts.ratio ?? 1.5;
  if (counts.length === 0) return null;
  let best = -1;
  let bestVal = -1;
  let secondVal = 0;
  for (let i = 0; i < counts.length; i++) {
    if (counts[i] > bestVal) {
      secondVal = bestVal;
      bestVal = counts[i];
      best = i;
    } else if (counts[i] > secondVal) {
      secondVal = counts[i];
    }
  }
  if (bestVal < minAbs) return null;
  if (secondVal > 0 && bestVal < secondVal * ratio) return null;
  return best;
}

/** Normalize an owner-cell OCR to a canonical ownership code. These 2-letter
 *  cells are below tesseract's reliable glyph size, so we demand an EXACT read
 *  (after stripping border/whitespace noise) and return null otherwise — a wrong
 *  owner (e.g. "TSP"→SP) is worse than an absent one. */
export function normalizeOwner(text: string | null): string | null {
  if (!text) return null;
  const t = text.toUpperCase().replace(/[^JTSPDC]/g, '');
  return t === 'JT' || t === 'SP' || t === 'DC' ? t : null;
}
// The filer writes "Full Asset Name - TICKER"; the ticker is the trailing all-caps
// token after the last dash. Allow 1–6 chars + an optional class suffix dot, and
// tolerate trailing OCR noise after it ("-VPL_ .-" → VPL).
const TRAILING_TICKER_RE = /[-—]\s*([A-Za-z]{1,6})(?:\.[A-Za-z])?[\s._\-]*$/;

export function cleanScannedAssetName(raw: string): string {
  return raw
    .replace(/\s+/g, ' ')
    .replace(/\s*[|]\s*/g, ' ')
    .trim();
}

/** Extract the trailing "- XXX" ticker the filer appended to the asset name. */
export function tickerFromAssetTail(assetName: string): string | null {
  const m = assetName.match(TRAILING_TICKER_RE);
  if (!m) return null;
  const t = m[1].toUpperCase();
  // Guard against catching a real word ("ETF", "INC", "CORP", "FUND") as a ticker.
  if (['ETF', 'INC', 'CORP', 'FUND', 'TR', 'CO', 'LP'].includes(t)) return null;
  return t;
}

/** OCR digit-repair for a month field. A real month is 01–12, so its tens digit
 *  is only 0 or 1; an out-of-range value means the tens digit was misread (e.g.
 *  0→9 gives "94"). Recover via the ones digit ("94"→4, "19"→9). */
export function repairOcrMonth(month: number): number | null {
  if (month >= 1 && month <= 12) return month;
  const ones = month % 10;
  return ones >= 1 && ones <= 9 ? ones : null;
}

export function parseMmDdYy(text: string | null, filingYear: number): string | null {
  if (!text) return null;
  const m = text.match(/(\d{1,2})\D(\d{1,2})\D(\d{2,4})/);
  if (!m) return null;
  const month = repairOcrMonth(Number(m[1]));
  const day = Number(m[2]);
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  if (month == null || day < 1 || day > 31) return null;
  // Sanity: a recovered date wildly off the filing year is more likely OCR noise.
  if (Math.abs(year - filingYear) > 1) return null;
  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day
    .toString()
    .padStart(2, '0')}`;
}

/** Map a checked type-column index to a transaction, adapting to the variant:
 *  3 columns = [Purchase, Sale, Exchange]; 4 columns = [Purchase, Sale, Partial
 *  Sale, Exchange]. */
export function typeFields(
  idx: number | null,
  columnCount: number
): { transactionType: string | null; description: string; category: TradeCategory } {
  if (idx == null)
    return { transactionType: null, description: 'Transaction (OCR)', category: 'other' };
  const four = columnCount >= 4;
  const table: Array<{ transactionType: string; description: string; category: TradeCategory }> =
    four
      ? [
          { transactionType: 'P', description: 'Purchase (OCR)', category: 'buy' },
          { transactionType: 'S', description: 'Sale (OCR)', category: 'sell' },
          { transactionType: 'S', description: 'Partial Sale (OCR)', category: 'sell' },
          { transactionType: 'E', description: 'Exchange (OCR)', category: 'exchange' },
        ]
      : [
          { transactionType: 'P', description: 'Purchase (OCR)', category: 'buy' },
          { transactionType: 'S', description: 'Sale (OCR)', category: 'sell' },
          { transactionType: 'E', description: 'Exchange (OCR)', category: 'exchange' },
        ];
  return (
    table[idx] ?? { transactionType: null, description: 'Transaction (OCR)', category: 'other' }
  );
}

/** Pure: interpret a frozen observation into TradeRecords. No I/O. */
export function interpretScannedHousePtr(
  obs: ScanObservation,
  ctx: ScannedHouseContext
): TradeRecord[] {
  const trades: TradeRecord[] = [];
  let index = 0;
  for (const row of obs.rows) {
    const assetName = cleanScannedAssetName(row.assetText);
    // A real transaction row needs at least an asset name with letters.
    if (!/[A-Za-z]{3}/.test(assetName)) continue;
    if (/^example\b/i.test(assetName)) continue;

    index += 1;
    const owner = normalizeOwner(row.ownerText);
    const ticker = tickerFromAssetTail(assetName);
    const typeIdx = pickCheckedCell(row.typeDark);
    // Only A–J are real amount bands; a trailing K column (spouse/dependent flag)
    // is never an amount, so ignore anything past the 10th cell.
    const amountIdx = pickCheckedCell(row.amountDark.slice(0, 10));
    const { transactionType, description, category } = typeFields(typeIdx, row.typeDark.length);
    const amount = amountIdx == null ? null : HOUSE_AMOUNT_RANGES[amountIdx];
    const range = amount
      ? parseDisclosureAmountRange(amount)
      : { amountMin: null, amountMax: null };
    const tradeDate =
      parseMmDdYy(row.tradeDateText, ctx.filingYear) ??
      parseMmDdYy(row.notifiedDateText, ctx.filingYear) ??
      ctx.filingDate ??
      `${ctx.filingYear}-01-01`;

    trades.push({
      externalId: `house-ptr:scan:${ctx.filingYear}:${ctx.docId}:${index}`,
      source: 'house-ptr',
      chamber: 'house',
      politicianName: ctx.filerName,
      filerName: ctx.filerName,
      owner,
      assetName,
      ticker,
      assetType: ticker ? 'ETF/Stock' : null,
      transactionType,
      transactionDescription: description,
      category,
      tradeDate,
      filingDate: ctx.filingDate,
      amount,
      amountRange: amount,
      amountMin: range.amountMin,
      amountMax: range.amountMax,
      filingDocId: ctx.docId,
      filingYear: ctx.filingYear,
      filingUrl: ctx.filingUrl,
      sourceUrl: ctx.filingUrl,
    });
  }
  return trades;
}

// ---------------------------------------------------------------------------
// PGM (P5) raster — raw grayscale, no image library needed
// ---------------------------------------------------------------------------

interface Pgm {
  W: number;
  H: number;
  px: Uint8Array;
}

function parsePgm(buf: Buffer): Pgm {
  let p = 0;
  const ws = (b: number) => b === 32 || b === 10 || b === 9 || b === 13;
  const tok = () => {
    while (ws(buf[p])) p++;
    if (buf[p] === 35) {
      // comment line
      while (buf[p] !== 10) p++;
      return tok();
    }
    const s = p;
    while (!ws(buf[p])) p++;
    return buf.toString('ascii', s, p);
  };
  const magic = tok();
  if (magic !== 'P5') throw new Error(`not a P5 PGM: ${magic}`);
  const W = Number(tok());
  const H = Number(tok());
  tok(); // maxval
  p++; // single whitespace after maxval
  return { W, H, px: buf.subarray(p, p + W * H) };
}

const DARK = 110; // 0=black, 255=white; an inked stroke is well under this

function dark(pgm: Pgm, x: number, y: number): boolean {
  return pgm.px[y * pgm.W + x] < DARK;
}

/** Dark-pixel count in the CENTER of a cell. An X mark crosses the middle, but an
 *  empty checkbox's outline sits at its perimeter and the table rules at the cell
 *  edges — so a central window reads ~0 for any empty cell (boxed or bare) and high
 *  only for a real mark. `centerFrac` = the fraction of the cell to sample. */
function cellDark(
  pgm: Pgm,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  centerFrac = 0.5
): number {
  const mx = (1 - centerFrac) / 2;
  const w = x1 - x0;
  const h = y1 - y0;
  const xa = Math.max(0, Math.round(x0 + w * mx));
  const xb = Math.min(pgm.W, Math.round(x1 - w * mx));
  const ya = Math.max(0, Math.round(y0 + h * mx));
  const yb = Math.min(pgm.H, Math.round(y1 - h * mx));
  let n = 0;
  for (let y = ya; y < yb; y++) {
    const row = y * pgm.W;
    for (let x = xa; x < xb; x++) if (pgm.px[row + x] < DARK) n++;
  }
  return n;
}

/** Collapse runs of adjacent coordinates into a single line position. */
function collapse(values: number[], gap = 6): number[] {
  const out: number[] = [];
  for (const v of values) {
    if (out.length === 0 || v - out[out.length - 1] > gap) out.push(v);
    else out[out.length - 1] = v;
  }
  return out;
}

/** Horizontal ruled lines (row borders): y where ≥`frac` of the x-span is dark. */
function detectHLines(
  pgm: Pgm,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  frac = 0.5
): number[] {
  const out: number[] = [];
  const span = x1 - x0;
  for (let y = Math.max(0, y0); y < Math.min(pgm.H, y1); y++) {
    let n = 0;
    for (let x = x0; x < x1; x++) if (dark(pgm, x, y)) n++;
    if (n > span * frac) out.push(y);
  }
  return collapse(out);
}

/** Vertical ruled lines (column borders): x where ≥`frac` of the y-span is dark. */
function detectVLines(
  pgm: Pgm,
  y0: number,
  y1: number,
  x0: number,
  x1: number,
  frac = 0.5
): number[] {
  const out: number[] = [];
  const span = y1 - y0;
  for (let x = Math.max(0, x0); x < Math.min(pgm.W, x1); x++) {
    let n = 0;
    for (let y = y0; y < y1; y++) if (dark(pgm, x, y)) n++;
    if (n > span * frac) out.push(x);
  }
  return collapse(out);
}

// ---------------------------------------------------------------------------
// Extraction (impure) — PDF → ScanObservation
// ---------------------------------------------------------------------------

/** Crop a single cell to its own PGM and OCR it in isolation. A clean one-cell
 *  strip OCRs far more reliably than the whole form (full-page `--psm 6` quality
 *  varies page-to-page). `mode: 'date'` adds a digit whitelist. */
async function ocrCell(
  pgm: Pgm,
  dir: string,
  tag: string,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  mode: 'text' | 'date' | 'owner',
  inset = 8
): Promise<string | null> {
  const xa = Math.max(0, x0 + inset);
  const xb = Math.min(pgm.W, x1 - inset);
  const ya = Math.max(0, y0 + inset);
  const yb = Math.min(pgm.H, y1 - inset);
  const w = xb - xa;
  const h = yb - ya;
  if (w < 10 || h < 10) return null;
  const body = Buffer.alloc(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) body[y * w + x] = pgm.px[(ya + y) * pgm.W + (xa + x)];
  const cropPath = join(dir, `${tag}.pgm`);
  await writeFile(cropPath, Buffer.concat([Buffer.from(`P5\n${w} ${h}\n255\n`), body]));
  const args =
    mode === 'date'
      ? [cropPath, 'stdout', '--psm', '7', '-c', 'tessedit_char_whitelist=0123456789/-']
      : mode === 'owner'
        ? [cropPath, 'stdout', '--psm', '8', '-c', 'tessedit_char_whitelist=JTSPDC']
        : // psm 6 (uniform block) — asset cells are sometimes 2 lines (e.g. a bond
          // name wraps), which psm 7 (single line) drops.
          [cropPath, 'stdout', '--psm', '6'];
  try {
    const { stdout } = await execFileAsync(TESSERACT, args, {
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    });
    if (mode === 'date') {
      const cleaned = stdout.replace(/\s+/g, '').trim();
      return cleaned.length >= 6 ? cleaned : null;
    }
    const cleaned = stdout.replace(/\s+/g, mode === 'owner' ? '' : ' ').trim();
    return cleaned.length > 0 ? cleaned : null;
  } catch {
    return null;
  }
}

interface PageColumns {
  amount: Array<[number, number]>; // A–J (always 10; a K "spouse/dependent" flag is ignored)
  type: Array<[number, number]>; // 3 (P/S/E) or 4 (P/S/Partial Sale/E)
  tradeDate: [number, number];
  notifiedDate: [number, number];
  ownerX0: number; // left edge of the owner column (table left border)
  assetX0: number; // left edge of the asset column (owner|asset border)
  assetX1: number; // right edge of the asset column
}

/** Longest run of near-equal consecutive gaps — the amount grid (the most
 *  numerous equal-width column block). Returns the [startIndex, length] into the
 *  gap array (length = number of columns in the run). */
function longestEqualRun(gaps: number[], tol = 0.3): { start: number; len: number } {
  let best = { start: 0, len: 0 };
  let i = 0;
  while (i < gaps.length) {
    let total = gaps[i];
    let cnt = 1;
    let j = i;
    while (j + 1 < gaps.length && Math.abs(gaps[j + 1] - total / cnt) <= (total / cnt) * tol) {
      j++;
      total += gaps[j];
      cnt++;
    }
    if (cnt > best.len) best = { start: i, len: cnt };
    i = j + 1;
  }
  return best;
}

/** Locate the form's columns from its ruled lines, ADAPTING to the known PTR
 *  variants (A–J vs A–K amount grids; 3- vs 4-column TYPE). Anchored on the
 *  amount grid — the longest equal-width run of verticals — with the (wider) date
 *  columns to its left, then the type columns, then asset/owner. Auto-calibrates
 *  to scan offset/scale. */
function detectColumns(pgm: Pgm, dataTop: number, dataBot: number): PageColumns | null {
  // Detect column rules over a y-range that REACHES UP into the column-label
  // header. True column rules run the full height (header + data); the inner
  // edges of open-box checkboxes exist only in the data rows — so spanning the
  // header lets a higher frac threshold reject the box edges and keep the rules.
  const yTop = Math.max(0, dataTop - Math.round(pgm.H * 0.14));
  const v = detectVLines(pgm, yTop, dataBot, Math.round(pgm.W * 0.26), pgm.W - 3, 0.62);
  if (v.length < 14) return null; // type(3-4)+dates(2)+amount(10-11) ≈ 16-19 verticals
  const gaps = v.slice(1).map((x, i) => x - v[i]);

  // Amount grid = longest equal-width run (10 cols A–J, or 11 with the K flag).
  const run = longestEqualRun(gaps);
  if (run.len < 10) return null;
  const aStart = run.start; // index of amount-grid's left border in `v`
  if (aStart < 3) return null; // need 2 date columns + a type border to its left
  const amount: Array<[number, number]> = [];
  for (let i = 0; i < 10; i++) amount.push([v[aStart + i], v[aStart + i + 1]]);
  const amountWidth = (v[aStart + run.len] - v[aStart]) / run.len;

  // Two (wider) date columns sit immediately left of the amount grid.
  const tradeDate: [number, number] = [v[aStart - 2], v[aStart - 1]];
  const notifiedDate: [number, number] = [v[aStart - 1], v[aStart]];

  // Type columns: the equal-width run ending at the date region's left border,
  // walking left until the (much wider) asset column.
  const type: Array<[number, number]> = [];
  let t = aStart - 2;
  while (t - 1 >= 0 && v[t] - v[t - 1] < amountWidth * 1.9) {
    type.unshift([v[t - 1], v[t]]);
    t--;
  }
  if (type.length < 3 || type.length > 4) return null;
  const assetX1 = v[t]; // asset|type border

  // Table-left border = the leftmost full-height rule.
  const leftBorders = detectVLines(
    pgm,
    dataTop,
    dataBot,
    Math.round(pgm.W * 0.015),
    Math.round(pgm.W * 0.12),
    0.4
  );
  const ownerX0 = leftBorders.length > 0 ? leftBorders[0] : Math.round(pgm.W * 0.05);
  // Asset text starts just past the narrow owner (SP/DC/JT) column — a consistent
  // ~0.047·W across form variants. Derived by offset rather than a vline, since the
  // owner|asset rule is often faint or the asset text spoofs a vertical.
  const assetX0 = Math.min(ownerX0 + Math.round(pgm.W * 0.047), assetX1 - Math.round(pgm.W * 0.06));
  return { amount, type, tradeDate, notifiedDate, ownerX0, assetX0, assetX1 };
}

async function renderPagesToPgm(
  pdfBytes: ArrayBuffer,
  dir: string,
  dpi: number,
  maxPages: number
): Promise<string[]> {
  const pdfPath = join(dir, 'in.pdf');
  await writeFile(pdfPath, Buffer.from(pdfBytes));
  await execFileAsync(
    PDFTOPPM,
    ['-gray', '-r', String(dpi), '-l', String(maxPages), pdfPath, join(dir, 'pg')],
    { timeout: 180_000, maxBuffer: 8 * 1024 * 1024 }
  );
  const { readdir } = await import('fs/promises');
  return (await readdir(dir))
    .filter((f) => /^pg-\d+\.pgm$/.test(f))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))
    .map((f) => join(dir, f));
}

/** Build a ScanObservation from a scanned House PTR PDF. Impure (poppler+tesseract). */
export async function extractScannedHouseObservation(
  pdfBytes: ArrayBuffer,
  opts: { dpi?: number; maxPages?: number } = {}
): Promise<ScanObservation> {
  const dpi = opts.dpi ?? 300;
  const maxPages = opts.maxPages ?? 16;
  const dir = await mkdtemp(join(tmpdir(), 'docvault-scanhouse-'));
  const rows: ScanRowObservation[] = [];
  try {
    const pgmPaths = await renderPagesToPgm(pdfBytes, dir, dpi, maxPages);
    for (let pageIdx = 0; pageIdx < pgmPaths.length; pageIdx++) {
      const pgm = parsePgm(await readFile(pgmPaths[pageIdx]));
      // Row borders across the table body (search the middle/lower page width).
      const x0 = Math.round(pgm.W * 0.07);
      const x1 = Math.round(pgm.W * 0.98);
      const hl = detectHLines(pgm, x0, x1, Math.round(pgm.H * 0.2), pgm.H - 4);
      // Candidate row borders ~one line-height apart. The floor is generous —
      // form variants differ (Fleischmann ≈ 0.047·H, Harshbarger ≈ 0.034·H).
      const minH = Math.round(pgm.H * 0.027);
      const maxH = Math.round(pgm.H * 0.08);
      const candidates: Array<[number, number]> = [];
      for (let i = 0; i < hl.length - 1; i++) {
        const h = hl[i + 1] - hl[i];
        if (h >= minH && h <= maxH) candidates.push([hl[i], hl[i + 1]]);
      }
      // The data rows are the longest run of ADJACENT bands — this drops orphan
      // header/legend boxes that happen to pass the height filter.
      let bands: Array<[number, number]> = [];
      let cur: Array<[number, number]> = [];
      for (const b of candidates) {
        if (cur.length === 0 || b[0] - cur[cur.length - 1][1] < 20) cur.push(b);
        else {
          if (cur.length > bands.length) bands = cur;
          cur = [b];
        }
      }
      if (cur.length > bands.length) bands = cur;
      if (bands.length === 0) continue;
      const cols = detectColumns(pgm, bands[0][0], bands[bands.length - 1][1]);
      if (process.env.DOCVAULT_SCAN_DEBUG)
        log.info(
          `page ${pageIdx + 1}: ${pgm.W}x${pgm.H} dataBands=${bands.length} cols=${cols ? `type${cols.type.length} amount${cols.amount.length}` : 'NULL'}`
        );
      if (!cols) continue;

      for (let bi = 0; bi < bands.length; bi++) {
        const [top, bot] = bands[bi];
        // Per-cell asset OCR — a single clean strip beats whole-page OCR, whose
        // quality varies page-to-page.
        const assetText =
          (await ocrCell(
            pgm,
            dir,
            `as-${pageIdx}-${bi}`,
            cols.assetX0,
            cols.assetX1,
            top,
            bot,
            'text',
            6
          )) ?? '';
        const tradeDateText = await ocrCell(
          pgm,
          dir,
          `td-${pageIdx}-${bi}`,
          cols.tradeDate[0],
          cols.tradeDate[1],
          top,
          bot,
          'date'
        );
        const notifiedDateText = await ocrCell(
          pgm,
          dir,
          `nd-${pageIdx}-${bi}`,
          cols.notifiedDate[0],
          cols.notifiedDate[1],
          top,
          bot,
          'date'
        );
        if (!/[A-Za-z]{3}/.test(assetText)) continue; // header/blank band
        if (/^example\b/i.test(assetText.trim())) continue;
        // Require a recovered date — only real transaction rows have one. This
        // drops the footnote/header bands that survive the geometry filter.
        if (!tradeDateText && !notifiedDateText) continue;

        const typeDark = cols.type.map(([a, b]) => cellDark(pgm, a, b, top, bot));
        const amountDark = cols.amount.map(([a, b]) => cellDark(pgm, a, b, top, bot));
        // Owner code (JT/SP/DC): a 2-letter cell too small for the full-page pass —
        // OCR it in isolation with a letter whitelist.
        const ownerText = await ocrCell(
          pgm,
          dir,
          `ow-${pageIdx}-${bi}`,
          cols.ownerX0,
          cols.assetX0,
          top,
          bot,
          'owner'
        );
        rows.push({
          ownerText,
          assetText,
          tradeDateText,
          notifiedDateText,
          typeDark,
          amountDark,
        });
      }
    }
    log.info(`scanned-house: observed ${rows.length} candidate row(s)`);
    return { rows };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Full pipeline: scanned PDF → TradeRecords. Returns [] if the form can't be read. */
export async function parseScannedHousePtr(
  pdfBytes: ArrayBuffer,
  ctx: ScannedHouseContext,
  opts: { dpi?: number; maxPages?: number } = {}
): Promise<TradeRecord[]> {
  const obs = await extractScannedHouseObservation(pdfBytes, opts);
  return interpretScannedHousePtr(obs, ctx);
}
