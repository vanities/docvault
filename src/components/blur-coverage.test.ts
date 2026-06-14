/// <reference types="node" />
// Blur-coverage invariant — guards the privacy toggle (`blurNumbers`).
//
// Personal dollar amounts MUST render inside <Money> (which applies the
// `blur-sm` CSS when the global blur toggle is on). This test caught a real
// class of leak where a view blurred its summary TOTALS but rendered the
// per-row amounts raw (e.g. IncomeView showing VA Disability $/mo, FileUploader
// upload-preview prices, the EstimatedTax "$X remaining" badge).
//
// It scans component .tsx files for a known personal-money formatter
// (formatUsd / formatUsdFull / formatUsdCompact / formatCurrency) rendered as a
// JSX child that is NOT wrapped in <Money>, and fails listing each site.
//
// Scope / limitations (by design, to stay low-false-positive):
//   • Only the NAMED formatters above — ad-hoc `$${x.toFixed()}` renders are
//     too noisy to distinguish from file sizes / percentages, so they are not
//     covered here (find those by manual review).
//   • PUBLIC/market money is exempt via ALLOW (Quant market prices, Politics
//     congressional-trade disclosures, chart axes that use blur-aware
//     formatters, Strategy market signals).
//   • Tooltip/aria STRINGS can't use the CSS <Money> blur; they mask values
//     conditionally instead, so prop-passes are excluded.

import { readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';
import { describe, expect, test } from 'vite-plus/test';

const COMPONENTS = path.resolve(import.meta.dirname);

/** Files/dirs that legitimately render public/market money, define the
 *  formatters, or feed blur-aware chart formatters — exempt from <Money>. */
const ALLOW: RegExp[] = [
  /[/\\]Quant[/\\]/, // market prices & macro series (public)
  /[/\\]Politics[/\\]/, // congressional-trade $ are public disclosures
  /[/\\]Predictions[/\\]/, // prediction-market odds (public)
  /Chart\.tsx$/, // chart axes/tooltips use blur-aware formatters (blurAxis)
  /[/\\]Strategy[/\\]StrategyView\.tsx$/, // market signal prices (public)
  /[/\\]common[/\\]Money\.tsx$/, // the primitive itself
  /\.test\.tsx?$/,
];

/** Named formatters whose output is PERSONAL money and must be blurred. */
const MONEY_FMT = /\b(formatUsd|formatUsdFull|formatUsdCompact|formatCurrency)\s*\(/;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith('.tsx')) out.push(full);
  }
  return out;
}

/** Blank out <Money>…</Money> blocks (multi-line safe) while preserving line
 *  numbers, so a formatter call wrapped across lines isn't a false positive. */
function stripMoney(content: string): string {
  return content.replace(/<Money[^>]*>[\s\S]*?<\/Money>/g, (m) => m.replace(/[^\n]/g, ' '));
}

function findViolations(): string[] {
  const out: string[] = [];
  for (const file of walk(COMPONENTS)) {
    if (ALLOW.some((re) => re.test(file))) continue;
    const stripped = stripMoney(readFileSync(file, 'utf8'));
    stripped.split('\n').forEach((line, i) => {
      if (!MONEY_FMT.test(line)) return;
      // Formatter definitions, not renders.
      if (/\b(function|const|=>)\s*format/.test(line)) return;
      // Prop-pass to a component/chart lib (those blur internally or are
      // strings that mask conditionally): value={…}, tooltip:, label=, etc.
      if (
        /\b(value|tooltip|label|title|sublabel|altValue|subtext|placeholder|formatter|tickFormatter|aria-[a-z]+)\s*[=:]/.test(
          line
        )
      )
        return;
      // Must look like a JSX child expression: `{…format…}` on its own line, or
      // `>{…format…}` right after a tag — not an assignment or template string.
      const trimmed = line.trim();
      const isJsxChild = trimmed.startsWith('{') || />\s*\{/.test(line);
      if (!isJsxChild) return;
      out.push(`${path.relative(COMPONENTS, file)}:${i + 1}  ${trimmed.slice(0, 100)}`);
    });
  }
  return out;
}

describe('blur coverage', () => {
  test('personal-money formatters render inside <Money>', () => {
    const violations = findViolations();
    expect(
      violations,
      `Currency renders outside <Money> — wrap them in <Money> (or add the file to ALLOW if the value is public/market data):\n  ${violations.join('\n  ')}`
    ).toEqual([]);
  });
});
