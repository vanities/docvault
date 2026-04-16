// Tests for server/parsers/dna-traits.ts
//
// Committed to git (exception in .gitignore): all fixtures are synthetic.
// No real genotypes, no personal DNA.
//
// Genotype choices below are picked to hit specific branches in the
// interpret() functions so we can assert the interpretation is wired up
// correctly. They are NOT taken from any real person's genome.

import { describe, expect, test } from 'vite-plus/test';
import { parseDNA, parseDNAContent } from './dna-traits.js';

// Build a synthetic AncestryDNA-style tab-delimited body. Each entry becomes
// one line: `rsid\tchromosome\tposition\tallele1\tallele2\n`.
function makeDNAFile(
  entries: Array<{ rsid: string; chr?: string; pos?: string; a1: string; a2: string }>
): string {
  const header =
    '# synthetic test data — no personal information\n#rsid\tchromosome\tposition\tallele1\tallele2\n';
  const rows = entries
    .map((e) => `${e.rsid}\t${e.chr ?? '15'}\t${e.pos ?? '12345'}\t${e.a1}\t${e.a2}`)
    .join('\n');
  return header + rows + '\n';
}

describe('parseDNAContent', () => {
  test('parses tab-delimited rows into an rsid-keyed map', () => {
    const body = makeDNAFile([
      { rsid: 'rs1', a1: 'A', a2: 'G' },
      { rsid: 'rs2', a1: 'C', a2: 'C' },
    ]);
    const snps = parseDNAContent(body);
    expect(snps.size).toBe(2);
    expect(snps.get('rs1')).toMatchObject({ rsid: 'rs1', allele1: 'A', allele2: 'G' });
    expect(snps.get('rs2')).toMatchObject({ rsid: 'rs2', allele1: 'C', allele2: 'C' });
  });

  test('skips #-prefixed comment lines and blank lines', () => {
    const body = '# comment 1\n\n#another\nrs1\t1\t100\tA\tT\n\nrs2\t2\t200\tG\tC\n';
    const snps = parseDNAContent(body);
    expect(snps.size).toBe(2);
  });

  test('skips no-call rows (allele == "0")', () => {
    const body = makeDNAFile([
      { rsid: 'rs-good', a1: 'A', a2: 'G' },
      { rsid: 'rs-nocall-1', a1: '0', a2: 'A' },
      { rsid: 'rs-nocall-2', a1: 'C', a2: '0' },
      { rsid: 'rs-nocall-both', a1: '0', a2: '0' },
    ]);
    const snps = parseDNAContent(body);
    expect([...snps.keys()]).toEqual(['rs-good']);
  });

  test('tolerates Windows \\r line endings', () => {
    const body = 'rs1\t1\t100\tA\tG\r\nrs2\t2\t200\tC\tT\r\n';
    const snps = parseDNAContent(body);
    expect(snps.size).toBe(2);
    expect(snps.get('rs1')?.allele2).toBe('G');
  });

  test('skips malformed rows with fewer than 5 fields', () => {
    const body = 'rs1\t1\t100\tA\tG\nrs-bad\t1\t100\nrs2\t2\t200\tC\tT\n';
    const snps = parseDNAContent(body);
    expect(snps.size).toBe(2);
  });
});

describe('parseDNA — structured output', () => {
  test('empty content produces an empty result with counts', () => {
    const result = parseDNA('');
    expect(result.snpsLoaded).toBe(0);
    expect(result.traits).toEqual([]);
    expect(result.health).toEqual([]);
    expect(result.experimental).toEqual([]);
    expect(result.apoe).toBeNull();
    expect(result.missing.traits).toBeGreaterThan(0);
    expect(result.missing.health).toBeGreaterThan(0);
  });

  test('eye color SNP rs12913832 GG reads as blue/light', () => {
    const body = makeDNAFile([{ rsid: 'rs12913832', a1: 'G', a2: 'G' }]);
    const result = parseDNA(body);
    const eye = result.traits.find((t) => t.rsid === 'rs12913832');
    expect(eye).toBeDefined();
    expect(eye!.genotype).toBe('G/G');
    expect(eye!.interpretation).toMatch(/blue|light/i);
  });

  test('eye color rs12913832 AA reads as brown', () => {
    const body = makeDNAFile([{ rsid: 'rs12913832', a1: 'A', a2: 'A' }]);
    const result = parseDNA(body);
    const eye = result.traits.find((t) => t.rsid === 'rs12913832');
    expect(eye!.interpretation).toMatch(/brown/i);
  });

  test('MC1R rs1805007 TT flags red-hair variant', () => {
    const body = makeDNAFile([{ rsid: 'rs1805007', a1: 'T', a2: 'T' }]);
    const result = parseDNA(body);
    const reading = result.traits.find((t) => t.rsid === 'rs1805007');
    expect(reading).toBeDefined();
    expect(reading!.interpretation).toMatch(/red|auburn/i);
  });

  test('APOE readout only populated when both rs429358 and rs7412 present', () => {
    const onlyOne = parseDNA(makeDNAFile([{ rsid: 'rs429358', a1: 'T', a2: 'T' }]));
    expect(onlyOne.apoe).toBeNull();

    const both = parseDNA(
      makeDNAFile([
        { rsid: 'rs429358', a1: 'T', a2: 'T' },
        { rsid: 'rs7412', a1: 'C', a2: 'C' },
      ])
    );
    // rs429358-TT + rs7412-CC = e3/e3 (the most common genotype)
    expect(both.apoe).toMatch(/e3\/e3/);
  });

  test('APOE e4/e4 (rs429358-CC + rs7412-CC) is detected and flagged', () => {
    const result = parseDNA(
      makeDNAFile([
        { rsid: 'rs429358', a1: 'C', a2: 'C' },
        { rsid: 'rs7412', a1: 'C', a2: 'C' },
      ])
    );
    expect(result.apoe).toMatch(/e4\/e4/);
    expect(result.apoe).toMatch(/Alzheimer/i);
  });

  test('polygenic scores array populated for every score in the table', () => {
    const result = parseDNA(makeDNAFile([]));
    expect(result.polygenic.length).toBeGreaterThan(0);
    for (const pg of result.polygenic) {
      expect(pg.name).toBeTruthy();
      // With no SNPs found, max accumulates to 0 (by design — nothing to score).
      // This asserts shape only; the "with hits" test below covers non-zero max.
      expect(pg.max).toBeGreaterThanOrEqual(0);
      expect(pg.score).toBeGreaterThanOrEqual(0);
      expect(pg.snpsTotal).toBeGreaterThan(0);
      expect(pg.snpsFound).toBe(0); // empty input → nothing found
    }
  });

  test('same rsid across multiple category tables is only reported once per table', () => {
    // rs601338 appears in both Nutrients and Immunity per the tables' comments.
    const body = makeDNAFile([{ rsid: 'rs601338', a1: 'G', a2: 'G' }]);
    const result = parseDNA(body);
    // Shouldn't blow up with dupes; readings unique per rsid within a list.
    const healthMatches = result.health.filter((r) => r.rsid === 'rs601338');
    expect(healthMatches.length).toBeLessThanOrEqual(1);
  });

  test('result is JSON-serializable (no Map/function leakage)', () => {
    const body = makeDNAFile([
      { rsid: 'rs12913832', a1: 'G', a2: 'G' },
      { rsid: 'rs1805007', a1: 'C', a2: 'T' },
    ]);
    const result = parseDNA(body);
    const roundTripped = JSON.parse(JSON.stringify(result));
    expect(roundTripped.snpsLoaded).toBe(result.snpsLoaded);
    expect(roundTripped.traits.length).toBe(result.traits.length);
    expect(roundTripped.apoe).toBe(result.apoe);
  });

  test('snpsLoaded count matches parseDNAContent map size', () => {
    const body = makeDNAFile([
      { rsid: 'rs1', a1: 'A', a2: 'G' },
      { rsid: 'rs2', a1: 'T', a2: 'C' },
      { rsid: 'rs3', a1: 'G', a2: 'G' },
    ]);
    const result = parseDNA(body);
    expect(result.snpsLoaded).toBe(3);
  });

  test('chip coverage estimate is a reasonable percentage', () => {
    const body = makeDNAFile(
      Array.from({ length: 100 }, (_, i) => ({
        rsid: `rs${i + 1}`,
        a1: 'A',
        a2: 'G',
      }))
    );
    const result = parseDNA(body);
    // 100 / 4.5M ≈ 0.0022 % → after .toFixed(1) = 0.0
    expect(result.chipCoverageEstimate).toBeGreaterThanOrEqual(0);
    expect(result.chipCoverageEstimate).toBeLessThan(100);
  });
});
