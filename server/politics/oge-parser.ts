// OGE Form 278-T transaction parser — ported verbatim from the Check the Vote
// repo (`lib/ingest/trades/oge-278t-parser.ts`).
//
// These are SCANNED PDFs (the President's periodic transaction reports), so the
// text arrives via OCR and is heavily mangled: O/Q read as 0, S read as $,
// transaction-type words misspelled ("rchaae" → purchase), dates with slashes
// dropped. Two strategies run and merge by sequence number, keeping the
// highest-quality row: plain `pdftotext -layout` text, and `-bbox-layout` word
// coordinates grouped into visual columns.

export type OgeTransaction = {
  sequence: number;
  assetName: string;
  transactionType: 'purchase' | 'sale' | 'exchange' | 'unknown';
  tradeDate: string;
  amount: string | null;
  rawLine: string;
};

function clean(value: string | null | undefined): string | null {
  const result = value?.replace(/\s+/g, ' ').trim();
  return result || null;
}

function normalizeMoneySide(value: string): string | null {
  const digits = value.replace(/[OQ]/gi, '0').replace(/[^0-9]/g, '');
  if (!digits) return null;
  return `$${Number(digits).toLocaleString('en-US')}`;
}

function parseMoneySide(value: string): number | null {
  const digits = value.replace(/[OQ]/gi, '0').replace(/[^0-9]/g, '');
  return digits ? Number(digits) : null;
}

const STANDARD_OGE_MAX_BY_MIN = new Map<number, number>([
  [1, 1000],
  [1001, 15000],
  [15001, 50000],
  [50001, 100000],
  [100001, 250000],
  [250001, 500000],
  [500001, 1000000],
  [1000001, 5000000],
  [5000001, 25000000],
  [25000001, 50000000],
]);

function repairOgeBandMax(low: number, high: number): number {
  if (high > low) return high;
  return STANDARD_OGE_MAX_BY_MIN.get(low) ?? high;
}

function isPlausibleOgeAmountRange(value: string): boolean {
  const parts = value.split('-');
  if (parts.length < 2) return false;
  const low = parseMoneySide(parts[0]);
  const high = parseMoneySide(parts.slice(1).join('-'));
  if (low == null || high == null) return false;
  return STANDARD_OGE_MAX_BY_MIN.get(low) === high;
}

export function normalizeOcrMoney(value: string): string {
  const normalized = value
    .replace(/[OQ]/gi, '0')
    .replace(/[•·–—]/g, '-')
    .replace(/\bS(?=\s*\d)/gi, '$')
    .replace(/\s+/g, ' ')
    .trim();
  const parts = normalized.split('-');
  if (parts.length >= 2) {
    const lowValue = parseMoneySide(parts[0]);
    const highValue = parseMoneySide(parts.slice(1).join('-'));
    if (lowValue != null && highValue != null) {
      const repairedHigh = repairOgeBandMax(lowValue, highValue);
      return `${normalizeMoneySide(String(lowValue))} - ${normalizeMoneySide(String(repairedHigh))}`;
    }
  }
  return normalized;
}

function formatDate(year: number, month: number, day: number): string | null {
  if (year < 100) year += 2000;
  if (!month || !day || !year) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day
    .toString()
    .padStart(2, '0')}`;
}

function parseCompactOcrDate(value: string): string | null {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 6) return null;

  const possibleYears = [digits.slice(-4), digits.slice(-2)];
  for (const yearText of possibleYears) {
    const year = Number(yearText.length === 2 ? `20${yearText}` : yearText);
    const prefix = digits.slice(0, digits.length - yearText.length);
    const candidates: Array<[number, number]> = [];

    for (let monthLength = 1; monthLength <= 2; monthLength++) {
      const monthText = prefix.slice(0, monthLength);
      const dayText = prefix.slice(monthLength);
      if (monthText && dayText) candidates.push([Number(monthText), Number(dayText)]);
    }

    // Acrobat OCR often reads slashes as a literal "1": 3/30/2026 -> 31302026.
    if (prefix.length === 4 && prefix[1] === '1') {
      candidates.push([Number(prefix[0]), Number(prefix.slice(2))]);
    }

    for (const [month, day] of candidates) {
      const parsed = formatDate(year, month, day);
      if (parsed) return parsed;
    }
  }

  return null;
}

export function normalizeOcrDate(value: string): string | null {
  const slashNormalized = value
    .replace(/[Il|]/g, '/')
    .replace(/[^0-9/]/g, '')
    .replace(/\/{2,}/g, '/');
  const parts = slashNormalized.split('/').filter(Boolean);

  if (parts.length >= 3) {
    const parsed = formatDate(Number(parts[2].slice(-4)), Number(parts[0]), Number(parts[1]));
    if (parsed) return parsed;
  }

  if (parts.length === 2 && parts[1].length >= 5) {
    const compactDayAndYear = parts[1];
    const year = Number(compactDayAndYear.slice(-4));
    const directDay = Number(compactDayAndYear.slice(0, -4));
    const parsedDirect = formatDate(year, Number(parts[0]), directDay);
    if (parsedDirect) return parsedDirect;

    // Acrobat sometimes keeps the first slash but OCRs the second as "1": 3/12/2026 -> 3/1212026.
    const possibleSlashArtifact = compactDayAndYear.slice(0, -4);
    if (possibleSlashArtifact.length === 3 && possibleSlashArtifact[2] === '1') {
      const parsedWithSlashArtifact = formatDate(
        year,
        Number(parts[0]),
        Number(possibleSlashArtifact.slice(0, 2))
      );
      if (parsedWithSlashArtifact) return parsedWithSlashArtifact;
    }
  }

  return parseCompactOcrDate(value);
}

export function normalizeTransactionType(value: string): OgeTransaction['transactionType'] {
  const lower = value
    .toLowerCase()
    .replace(/[0]/g, 'o')
    .replace(/[1|]/g, 'l')
    .replace(/[^a-z]/g, '');

  if (
    lower.includes('sale') ||
    lower.includes('salo') ||
    lower.includes('solo') ||
    lower.includes('aalo') ||
    lower === 's'
  ) {
    return 'sale';
  }
  if (lower.includes('exchange')) return 'exchange';
  if (
    lower.includes('purchase') ||
    lower.includes('purch') ||
    lower.includes('urch') ||
    lower.includes('rchase') ||
    lower.includes('rchaso') ||
    lower.includes('rchaae') ||
    lower.includes('rchao') ||
    lower.includes('rchalo') ||
    lower.includes('rchmo') ||
    lower.includes('urth') ||
    lower.includes('urdi') ||
    lower.includes('purd') ||
    lower.includes('punh') ||
    lower.includes('unhale') ||
    lower.includes('unchale') ||
    lower.includes('uncniso')
  ) {
    return 'purchase';
  }

  return 'unknown';
}

function coerceTradeDateToFilingWindow(tradeDate: string, filingYear: number): string {
  const year = Number(tradeDate.slice(0, 4));
  if (year === filingYear || year === filingYear - 1) return tradeDate;
  return `${filingYear}${tradeDate.slice(4)}`;
}

const ROW_START_PATTERN = /^\s*(?<seq>\d{1,4})\b(?:\s+(?<body>.+))?$/;
const DATE_PATTERN = /\d{1,2}\s*[/Il|l]\s*\d{1,2}(?:\s*[/Il|l]?\s*\d{2,4})?|\b\d{6,9}\b/g;
const AMOUNT_PATTERN =
  /(?:[$S]\s*)?[\dOQS][\dOQS,.\s]*\s*[-•·–—]\s*(?:[$S]\s*)?[\dOQS][\dOQS,.\s]*/gi;

function looksLikeTransactionRowStart(sequence: number): boolean {
  return sequence >= 1 && sequence <= 4999;
}

function buildCandidateRecords(
  text: string
): Array<{ sequence: number; body: string; raw: string }> {
  const records: Array<{ sequence: number; body: string; raw: string }> = [];
  let current: { sequence: number; body: string[]; raw: string[] } | null = null;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\f/g, ' ').trim();
    if (!line) continue;

    const match = line.match(ROW_START_PATTERN);
    const sequence = match?.groups?.seq ? Number(match.groups.seq) : null;
    if (sequence != null && looksLikeTransactionRowStart(sequence)) {
      if (current) {
        records.push({
          sequence: current.sequence,
          body: current.body.join(' '),
          raw: current.raw.join('\n'),
        });
      }
      current = { sequence, body: [match?.groups?.body ?? ''], raw: [raw] };
      continue;
    }

    if (current) {
      current.body.push(line);
      current.raw.push(raw);
    }
  }

  if (current) {
    records.push({
      sequence: current.sequence,
      body: current.body.join(' '),
      raw: current.raw.join('\n'),
    });
  }

  return records;
}

function findAmount(body: string): { amount: string; index: number; raw: string } | null {
  const matches = [...body.matchAll(AMOUNT_PATTERN)].filter((match) => match.index != null);
  const match = matches.at(-1);
  if (!match || match.index == null) return null;
  const amount = normalizeOcrMoney(match[0]);
  if (!/^\$[\d,]+ - \$[\d,]+$/.test(amount)) return null;
  if (!isPlausibleOgeAmountRange(amount)) return null;
  return { amount, index: match.index, raw: match[0] };
}

function findTradeDate(
  beforeAmount: string,
  filingYear: number
): { tradeDate: string; index: number; raw: string } | null {
  const matches = [...beforeAmount.matchAll(DATE_PATTERN)].filter((match) => match.index != null);
  for (const match of matches.reverse()) {
    if (match.index == null) continue;
    const parsed = normalizeOcrDate(match[0]);
    if (!parsed) continue;
    return {
      tradeDate: coerceTradeDateToFilingWindow(parsed, filingYear),
      index: match.index,
      raw: match[0],
    };
  }
  return null;
}

function findTransactionTypeAndAsset(beforeDate: string): {
  transactionType: OgeTransaction['transactionType'];
  assetName: string;
} | null {
  const withoutHeaders = beforeDate
    .replace(/\b(?:Description|DncrlDtlan|Date|Notification|Amount|Days\s+Ago|DavaAgo)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const tokens = withoutHeaders.split(/\s+/).filter((token) => /[A-Za-z0-9]/.test(token));
  if (tokens.length === 0) return null;

  for (let size = 1; size <= Math.min(4, tokens.length); size++) {
    const candidate = tokens.slice(-size).join(' ');
    const transactionType = normalizeTransactionType(candidate);
    if (transactionType === 'unknown') continue;

    let typeTokenCount = size;
    if (size === 1 && tokens.length >= 2 && /^[Il|]$/.test(tokens.at(-2) ?? '')) {
      typeTokenCount = 2;
    }

    const assetName = clean(tokens.slice(0, -typeTokenCount).join(' '))
      ?.replace(/[|]+/g, '')
      .trim();
    if (assetName && assetName.length >= 2) return { transactionType, assetName };
  }

  // Keep rows with a good sequence/date/amount even when Acrobat mangles the type
  // cell beyond recognition. The last short token before the date is normally the
  // transaction-type column, so strip it from the asset.
  const fallbackAsset = clean(tokens.slice(0, -1).join(' ')) ?? clean(withoutHeaders);
  return fallbackAsset ? { transactionType: 'unknown', assetName: fallbackAsset } : null;
}

function parseCandidateRecord(
  record: { sequence: number; body: string; raw: string },
  filingYear: number
): OgeTransaction | null {
  const body = record.body.replace(/\s+/g, ' ').trim();
  const amount = findAmount(body);
  if (!amount) return null;

  const beforeAmount = body.slice(0, amount.index).trim();
  const date = findTradeDate(beforeAmount, filingYear);
  if (!date) return null;

  const beforeDate = beforeAmount.slice(0, date.index).trim();
  const typeAndAsset = findTransactionTypeAndAsset(beforeDate);
  if (!typeAndAsset) return null;

  return {
    sequence: record.sequence,
    assetName: typeAndAsset.assetName,
    transactionType: typeAndAsset.transactionType,
    tradeDate: date.tradeDate,
    amount: amount.amount,
    rawLine: record.raw.replace(/\s+/g, ' ').trim(),
  };
}

function transactionQuality(transaction: OgeTransaction): number {
  let score = 0;
  if (transaction.transactionType !== 'unknown') score += 3;
  if (transaction.assetName.length >= 4) score += 1;
  if (/^[A-Za-z0-9]/.test(transaction.assetName)) score += 1;
  if (!/[{}<>]/.test(transaction.assetName)) score += 1;
  return score;
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

type BboxWord = { xMin: number; xMax: number; y: number; text: string };
type BboxLine = { y: number; words: BboxWord[] };

function wordsFromBboxPage(pageXml: string): BboxWord[] {
  const words: BboxWord[] = [];
  const wordPattern =
    /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)<\/word>/gs;
  for (const match of pageXml.matchAll(wordPattern)) {
    const [, xMin, yMin, xMax, yMax, text] = match;
    words.push({
      xMin: Number(xMin),
      xMax: Number(xMax),
      y: (Number(yMin) + Number(yMax)) / 2,
      text: decodeXmlText(text),
    });
  }
  return words;
}

function groupWordsIntoVisualLines(words: BboxWord[]): BboxLine[] {
  const lines: BboxLine[] = [];
  for (const word of words.toSorted((a, b) => a.y - b.y || a.xMin - b.xMin)) {
    const existing = lines.find((line) => Math.abs(line.y - word.y) < 3);
    if (existing) {
      existing.words.push(word);
      existing.y = existing.words.reduce((sum, item) => sum + item.y, 0) / existing.words.length;
    } else {
      lines.push({ y: word.y, words: [word] });
    }
  }
  return lines;
}

function lineText(words: BboxWord[]): string {
  return (
    clean(
      words
        .toSorted((a, b) => a.xMin - b.xMin)
        .map((word) => word.text)
        .join(' ')
    ) ?? ''
  );
}

function parseBboxSequence(words: BboxWord[]): number | null {
  const firstWord = words.toSorted((a, b) => a.xMin - b.xMin)[0];
  if (!firstWord || firstWord.xMin > 130 || !/^\d{1,4}$/.test(firstWord.text)) return null;
  const sequence = Number(firstWord.text);
  return looksLikeTransactionRowStart(sequence) ? sequence : null;
}

function parseBboxLine(line: BboxLine, filingYear: number): OgeTransaction | null {
  const words = line.words.toSorted((a, b) => a.xMin - b.xMin);
  const sequence = parseBboxSequence(words);
  if (!sequence) return null;

  const rawLine = lineText(words);
  const dateWord = words.find((word) => word.xMin > 400 && normalizeOcrDate(word.text));
  if (!dateWord) return null;

  const descriptionEnd = dateWord.xMin - 110;
  const typeStart = dateWord.xMin - 110;
  const typeEnd = dateWord.xMin - 10;
  const amountStart = dateWord.xMin + 50;

  const description = lineText(words.slice(1).filter((word) => word.xMin < descriptionEnd));
  const typeRaw = lineText(words.filter((word) => word.xMin >= typeStart && word.xMin < typeEnd));
  const dateRaw = dateWord.text;
  const amountRaw = lineText(words.filter((word) => word.xMin >= amountStart));
  const amountMatch = amountRaw.match(AMOUNT_PATTERN) ?? rawLine.match(AMOUNT_PATTERN);
  if (!amountMatch) return null;
  const amount = normalizeOcrMoney(amountMatch[0]);
  if (!/^\$[\d,]+ - \$[\d,]+$/.test(amount)) return null;
  if (!isPlausibleOgeAmountRange(amount)) return null;

  const parsedTradeDate = normalizeOcrDate(dateRaw);
  if (!parsedTradeDate) return null;

  const transactionType = normalizeTransactionType(typeRaw);
  if (description) {
    return {
      sequence,
      assetName: description,
      transactionType,
      tradeDate: coerceTradeDateToFilingWindow(parsedTradeDate, filingYear),
      amount,
      rawLine,
    };
  }

  return parseCandidateRecord({ sequence, body: rawLine, raw: rawLine }, filingYear);
}

export function mergeOgeTransactions(...transactionLists: OgeTransaction[][]): OgeTransaction[] {
  const bySequence = new Map<number, OgeTransaction>();
  for (const transaction of transactionLists.flat()) {
    const existing = bySequence.get(transaction.sequence);
    if (!existing || transactionQuality(transaction) > transactionQuality(existing)) {
      bySequence.set(transaction.sequence, transaction);
    }
  }
  return [...bySequence.values()].sort((a, b) => a.sequence - b.sequence);
}

export function parseOge278Transactions(text: string, filingYear: number): OgeTransaction[] {
  return mergeOgeTransactions(
    buildCandidateRecords(text)
      .map((record) => parseCandidateRecord(record, filingYear))
      .filter((transaction): transaction is OgeTransaction => transaction != null)
  );
}

export function parseOge278TransactionsFromBboxLayout(
  bboxLayoutXml: string,
  filingYear: number
): OgeTransaction[] {
  const pagePattern = /<page\b[^>]*>(.*?)<\/page>/gs;
  const transactions: OgeTransaction[] = [];

  for (const pageMatch of bboxLayoutXml.matchAll(pagePattern)) {
    const pageXml = pageMatch[1];
    const words = wordsFromBboxPage(pageXml);
    for (const line of groupWordsIntoVisualLines(words)) {
      const transaction = parseBboxLine(line, filingYear);
      if (transaction) transactions.push(transaction);
    }
  }

  return mergeOgeTransactions(transactions);
}

export function categoryFor(
  transactionType: OgeTransaction['transactionType']
): 'buy' | 'sell' | 'exchange' | 'other' {
  if (transactionType === 'purchase') return 'buy';
  if (transactionType === 'sale') return 'sell';
  if (transactionType === 'exchange') return 'exchange';
  return 'other';
}
