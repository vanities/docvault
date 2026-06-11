// Research-domain wiring invariants — the companion to navigation-wiring.test.ts
// for the research system.
//
// `RESEARCH_DOMAINS` in server/routes/research.ts is the single source of
// truth: parseDomain, the GET /api/research?domain= filter, and the chat tool
// enums all DERIVE from it, so they can't drift. Two surfaces cannot derive
// from a server constant and must be wired by hand whenever a domain is added:
//
//   1. The `ResearchPanelDomain` union in ResearchPanel.tsx — which domains
//      the shared inbox panel will render.
//   2. A view that actually renders `<ResearchPanel domain="X" />` (thin
//      wrapper per the TechView/LocalNewsView pattern) plus its sidebar/nav
//      wiring — which navigation-wiring.test.ts then guards.
//
// This test cross-checks those surfaces against RESEARCH_DOMAINS by parsing
// source text (same deliberately-dumb-regex approach as navigation-wiring) and
// names the missing piece. It also pins the derivation points themselves so a
// refactor back to hand-written literal enums fails loudly.
//
// Known bespoke surfaces (NOT wired through the generic panel):
//   - 'health'  → Health section has its own person-tagged research UI.
//   - 'finance' → rendered by QuantView via ResearchPanel's default domain.

import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { describe, expect, test } from 'vite-plus/test';

const ROOT = path.resolve(__dirname, '..');
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8');

// ---------------------------------------------------------------------------
// Extractors
// ---------------------------------------------------------------------------

/** Literals of the RESEARCH_DOMAINS const in server/routes/research.ts. */
function extractServerDomains(source: string): string[] {
  const match = source.match(/RESEARCH_DOMAINS\s*=\s*\[([\s\S]*?)\]\s*as const/);
  if (!match) throw new Error('Could not find RESEARCH_DOMAINS in server/routes/research.ts');
  return (match[1].match(/'([^']+)'/g) ?? []).map((l) => l.slice(1, -1));
}

/** Literals of the ResearchPanelDomain union in ResearchPanel.tsx. */
function extractPanelDomains(source: string): string[] {
  const match = source.match(/type ResearchPanelDomain\s*=\s*([^;]+);/);
  if (!match) throw new Error('Could not find ResearchPanelDomain in ResearchPanel.tsx');
  return (match[1].match(/'([^']+)'/g) ?? []).map((l) => l.slice(1, -1));
}

/** Every `<ResearchPanel ... domain="X"` usage under src/components. */
function collectRenderedDomains(): Map<string, string> {
  const rendered = new Map<string, string>(); // domain → file
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!name.endsWith('.tsx') || name.includes('.test.')) continue;
      const source = readFileSync(full, 'utf8');
      const re = /<ResearchPanel\b[^>]*?domain="([a-z-]+)"/gs;
      let m;
      while ((m = re.exec(source))) rendered.set(m[1], path.relative(ROOT, full));
    }
  };
  walk(path.join(ROOT, 'src', 'components'));
  return rendered;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const serverSource = read('server/routes/research.ts');
const panelSource = read('src/components/Quant/ResearchPanel.tsx');
const domains = extractServerDomains(serverSource);
const panelDomains = extractPanelDomains(panelSource);
const rendered = collectRenderedDomains();

// Domains with bespoke UI instead of a generic-panel wrapper view.
const BESPOKE_UI = new Set(['health']);
// Domains rendered through ResearchPanel's default-domain prop, not an explicit attr.
const DEFAULT_PROP = new Set(['finance']);

describe('research domain wiring', () => {
  test('RESEARCH_DOMAINS parses and is non-trivial', () => {
    expect(domains.length).toBeGreaterThanOrEqual(5);
    expect(domains).toContain('finance');
  });

  test.each(domains.filter((d) => !BESPOKE_UI.has(d)))(
    'domain "%s" is renderable by ResearchPanel (ResearchPanelDomain union)',
    (domain) => {
      expect(
        panelDomains,
        `'${domain}' is in RESEARCH_DOMAINS but missing from the ResearchPanelDomain union in ` +
          `src/components/Quant/ResearchPanel.tsx — add it so the shared inbox panel accepts it.`
      ).toContain(domain);
    }
  );

  test.each(domains.filter((d) => !BESPOKE_UI.has(d) && !DEFAULT_PROP.has(d)))(
    'domain "%s" has a view rendering it via <ResearchPanel domain=…>',
    (domain) => {
      expect(
        rendered.has(domain),
        `'${domain}' is in RESEARCH_DOMAINS but no component renders ` +
          `<ResearchPanel domain="${domain}"> — create a thin wrapper view (see ` +
          `src/components/Tech/TechView.tsx) and wire its sidebar nav ` +
          `(navigation-wiring.test.ts guards that part).`
      ).toBe(true);
    }
  );

  test('no panel/rendered domain has drifted away from RESEARCH_DOMAINS', () => {
    for (const d of panelDomains) {
      expect(
        domains,
        `ResearchPanelDomain contains '${d}' which is not in RESEARCH_DOMAINS — remove it or add it server-side.`
      ).toContain(d);
    }
    for (const [d, file] of rendered) {
      expect(domains, `${file} renders domain="${d}" which is not in RESEARCH_DOMAINS.`).toContain(
        d
      );
    }
  });

  test('derivation points stay derived (no hand-written domain enums creep back)', () => {
    // Chat research tools must build their zod enums from the shared constant.
    const chatSource = read('server/routes/chat.ts');
    expect(
      (chatSource.match(/z\s*\.\s*enum\(RESEARCH_DOMAINS\)/g) ?? []).length,
      'list_research/search_research in server/routes/chat.ts must use z.enum(RESEARCH_DOMAINS), not literal arrays.'
    ).toBeGreaterThanOrEqual(2);

    // The GET list filter must validate through the shared guard.
    expect(serverSource).toMatch(/isResearchDomain\(domainParam\)/);

    // The Daily News digest must pull ALL domains (no-arg listResearchEntries),
    // so any future domain reaches the paper (Research & Analysis desk) by
    // construction even before it gets a dedicated desk.
    const newsSource = read('server/daily-news.ts');
    expect(newsSource).toMatch(/listResearchEntries\(\)/);
  });
});
