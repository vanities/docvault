// Fabricated saved sources and reports for native tests. No external providers,
// mail, transcripts, identities, or private vault data are used.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Buffer } from 'node:buffer';
import { sleep } from 'bun';
import type { Runner } from '../server/deep-research-store';
import type { Generator } from '../server/daily-news-store';

export const researchText =
  '# Synthetic source\n\nA fictional observation 🧪 supports a careful comparison.\n\n| Signal | Observation |\n| --- | --- |\n| DEMO | Invented example |\n\n- Read the saved source.\n- Verify its context.\n';
export const researchReport =
  '# Synthetic research report\n\n## Findings\n\nThis report is fabricated for interface tests. [Saved source](https://example.com/research) supports an invented comparison.\n\n| Signal | Status |\n| --- | --- |\n| DEMO | Observation only |\n| SAMPLE | No recommendation |\n\n1. Review the source.\n2. Check the cited context.\n\n## Limitations\n\nNo live model or external research was used.\n';
export const newsBody =
  '# Synthetic morning edition\n\n## The lead\n\nA fictional science fair opens this week. [Acme Gazette](https://example.com/news) provides the fabricated source ledger entry.\n\n| Desk | Saved items |\n| --- | --- |\n| Local | 2 |\n| Tech | 1 |\n\n## Around the desks\n\n- A demo library extends its fictional opening hours.\n- A fabricated workshop explores native interfaces.\n\n## Reading notes\n\nAll material in this edition is invented.\n';
export function syntheticWAV(): Buffer {
  const samples = 24_000 * 4;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(24_000, 24);
  wav.writeUInt32LE(48_000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(samples * 2, 40);
  return wav;
}
export const syntheticResearchRunner: Runner = async (question, options) => {
  await sleep(750);
  if (question.includes('synthetic failure'))
    throw new Error('Synthetic research provider failure');
  return {
    question,
    report: researchReport,
    sources: [{ url: 'https://example.com/research', title: 'Acme Research Source' }],
    searchCount: Math.min(options?.maxSearches ?? 18, 3),
    usage: { inputTokens: 120, outputTokens: 240 },
    generatedBy: { model: 'synthetic-fixture', billing: 'api', backend: 'isolated fixture' },
  };
};
export const syntheticNewsGenerator: Generator = async (_type, _date, sinceISO) => {
  await sleep(750);
  return {
    title: 'Synthetic morning edition',
    body: newsBody,
    theme: 'brew',
    usage: { inputTokens: 90, outputTokens: 180 },
    generatedBy: { model: 'synthetic-fixture', billing: 'api', backend: 'isolated fixture' },
    digestMeta: {
      sources: ['Acme Gazette'],
      sinceISO,
      itemCount: 3,
      pulled: [
        {
          source: 'Acme Gazette',
          title: 'A fictional science fair',
          url: 'https://example.com/news',
        },
      ],
      sourceWarnings: [
        { source: 'Acme Wire', message: 'Synthetic source unavailable; edition is partial.' },
      ],
    },
  };
};

export async function seedNativeResearch(dataDir: string, pdfBytes: Uint8Array) {
  await mkdir(path.join(dataDir, 'research'), { recursive: true });
  const entries: Record<string, unknown> = {};
  for (const domain of ['finance', 'health', 'politics', 'tech', 'local']) {
    const id = domain + 'source';
    const quote = 'A fictional observation 🧪 supports a careful comparison.';
    const charStart = researchText.indexOf(quote);
    const provenance = {
      entryId: id,
      title: 'Acme ' + domain + ' source',
      sourceUrl: 'https://example.com/' + domain,
      publisher: 'Acme Research',
      reportDate: '2026-10-01',
      mediaType: 'text/plain',
      lineStart: 3,
      lineEnd: 3,
      charStart,
      charEnd: charStart + quote.length,
      quote,
    };
    entries[id] = {
      id,
      domain,
      title: 'Acme ' + domain + ' source',
      filename: id + '.txt',
      filePath: 'research/' + id + '.txt',
      mediaType: 'text/plain',
      uploadedAt: '2026-10-01T12:00:00Z',
      text: researchText,
      pageCount: null,
      extractedAt: null,
      extractorVersion: null,
      extractError: null,
      publisher: 'Acme Research',
      author: 'Demo Author',
      reportDate: '2026-10-01',
      tags: ['synthetic'],
      tickers: ['DEMO'],
      notes: 'Invented research for native interface tests.',
      linkedPersonIds: [],
      intelligence: {
        version: 1,
        summary: [{ text: 'Synthetic summary with an exact saved quote.', provenance }],
        claims: [
          {
            id: 'syntheticclaim',
            text: 'The fictional observation supports a comparison, with limited context.',
            tickers: ['DEMO'],
            topics: ['comparison'],
            stance: 'watch',
            provenance,
          },
        ],
      },
    };
    await writeFile(path.join(dataDir, 'research', id + '.txt'), researchText);
  }
  entries.financepdf = {
    id: 'financepdf',
    domain: 'finance',
    title: 'Acme saved PDF',
    filename: 'Synthetic Source.pdf',
    filePath: 'research/financepdf.pdf',
    mediaType: 'application/pdf',
    uploadedAt: '2026-09-01T12:00:00Z',
    text: 'Synthetic PDF source.',
    pageCount: 1,
    extractError: null,
    publisher: 'Acme Archive',
    reportDate: '2026-09-01',
    tickers: [],
    tags: [],
  };
  entries.financeaudio = {
    id: 'financeaudio',
    domain: 'finance',
    title: 'Acme unfinished narration',
    filename: 'Synthetic Audio.wav',
    filePath: 'research/financeaudio.wav',
    mediaType: 'audio/wav',
    uploadedAt: '2026-08-01T12:00:00Z',
    text: null,
    transcribeStatus: 'error',
    transcribeError: 'Synthetic transcription unavailable.',
    reportDate: '2026-08-01',
    tickers: [],
    tags: [],
  };
  await writeFile(
    path.join(dataDir, '.docvault-research.json'),
    JSON.stringify({ version: 1, entries })
  );
  await writeFile(path.join(dataDir, 'research', 'financepdf.pdf'), pdfBytes);
  await writeFile(path.join(dataDir, 'research', 'financeaudio.wav'), syntheticWAV());
  const run = {
    id: 'syntheticreport',
    question: 'Compare fictional sources',
    status: 'done',
    maxSearches: 18,
    report: researchReport,
    sources: [{ url: 'https://example.com/research', title: 'Acme Research Source' }],
    searchCount: 3,
    usage: { inputTokens: 120, outputTokens: 240 },
    generatedBy: { model: 'synthetic-fixture', billing: 'api', backend: 'isolated fixture' },
    createdAt: '2026-10-01T12:00:00Z',
    completedAt: '2026-10-01T12:01:00Z',
  };
  await writeFile(
    path.join(dataDir, '.docvault-deep-research.json'),
    JSON.stringify({
      syntheticreport: run,
      syntheticerror: {
        id: 'syntheticerror',
        question: 'A failed synthetic run',
        status: 'error',
        error: 'Synthetic provider unavailable.',
        maxSearches: 18,
        createdAt: '2026-09-01T12:00:00Z',
      },
    })
  );
  const generated = await syntheticNewsGenerator('daily', '2026-10-01', '2026-09-29T12:00:00Z');
  const edition = {
    id: 'syntheticnews',
    editionType: 'daily',
    editionDate: '2026-10-01',
    status: 'done',
    ...generated,
    audioPath: 'syntheticnews.wav',
    weather: {
      label: 'Demo City',
      units: 'F',
      days: [
        { date: '2026-10-01', hi: 72, lo: 50, emoji: '☀️', label: 'Clear', precipPct: 5 },
        { date: '2026-10-02', hi: 68, lo: 48, emoji: '🌦️', label: 'Showers', precipPct: 30 },
        { date: '2026-10-03', hi: 70, lo: 49, emoji: '☀️', label: 'Clear', precipPct: 0 },
      ],
    },
    sun: {
      date: '2026-10-01',
      sunrise: '7:00 AM',
      sunset: '6:45 PM',
      daylight: '11h 45m',
      delta: '-2m',
    },
    weekAhead: {
      start: '2026-10-01',
      end: '2026-10-07',
      items: [
        { date: '2026-10-03', title: 'Acme science fair', kind: 'event', emoji: '🔬' },
        { date: '2026-10-01', title: 'Demo library task', kind: 'todo', overdue: true },
      ],
    },
    createdAt: '2026-10-01T12:00:00Z',
    completedAt: '2026-10-01T12:01:00Z',
  };
  await writeFile(
    path.join(dataDir, '.docvault-daily-news.json'),
    JSON.stringify({
      syntheticnews: edition,
      syntheticsample: { ...edition, id: 'syntheticsample', sample: true, theme: 'broadsheet' },
    })
  );
  await mkdir(path.join(dataDir, 'daily-news-audio'), { recursive: true });
  await writeFile(path.join(dataDir, 'daily-news-audio', 'syntheticnews.wav'), syntheticWAV());
}
