// Research generator — Claude-backed evidence + citation generation for supplements.
//
// Given a supplement's productName/brandName/category/active ingredients, calls
// Claude with a forced tool schema that returns structured research prose +
// citations. Used by POST /api/health/:personId/nutrition/:id/generate-research.
//
// Intentionally product-scoped (no person-specific health data is passed) —
// the generated research is generic evidence-based analysis for a healthy
// adult. Person-specific framing still happens in conversation with Claude,
// not via this endpoint.

import type Anthropic from '@anthropic-ai/sdk';
import { callClaude, extractToolResult } from './base.js';
import type { ParsedNutritionLabel, NutrientEntry } from './nutrition-label.js';
import type { NutritionCitation } from '../routes/nutrition.js';
import { createLogger } from '../logger.js';

const log = createLogger('ResearchGenerator');

export interface GeneratedResearch {
  research: string;
  citations: NutritionCitation[];
}

const RESEARCH_TOOL: Anthropic.Messages.Tool = {
  name: 'emit_supplement_research',
  description:
    'Emit structured evidence-backed research for a supplement, with markdown prose and structured citations.',
  input_schema: {
    type: 'object',
    properties: {
      research: {
        type: 'string',
        description: [
          'Markdown research prose for a generally healthy adult. Structure:',
          '- **Why:** one paragraph on the typical indication(s) people take it for.',
          '- **Evidence:** bulleted key studies with inline numbered citations like [1], [2]. Include effect sizes (mg/dL, mmHg, %, RR). Note when evidence is weak (single small trial, in vitro only, unreplicated) and when strong (meta-analyses, replicated RCTs, outcome trials).',
          '- **Dose context:** typical study-effective dose vs. common product serving. Note RDAs and ULs when relevant.',
          '- **Watch-fors:** side effects, interactions, labs that can look abnormal, drug interactions.',
          'Do NOT include a "References" section — the citations array is rendered separately.',
          'Do NOT include "Stress test" or tailored sections referring to a specific person — this endpoint generates generic research.',
        ].join('\n'),
      },
      citations: {
        type: 'array',
        description:
          'Every numbered reference in the research prose must appear in this array, in order. Only cite papers you are confident exist — do not fabricate PMIDs.',
        items: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'Short stable id like "zhang-2016-bp" — kebab-case.',
            },
            pmid: {
              type: 'string',
              description:
                'PubMed ID (digits only) if you are confident it is correct. Omit if unsure.',
            },
            doi: { type: 'string', description: 'DOI if known. Omit if unsure.' },
            authors: {
              type: 'string',
              description: 'First author + "et al." for long author lists, or the full list.',
            },
            year: { type: 'integer' },
            title: { type: 'string' },
            journal: { type: 'string' },
            findings: {
              type: 'string',
              description:
                'One-line summary of the key finding from this paper. Include effect size where applicable.',
            },
            url: { type: 'string', description: 'Optional URL for open-access papers.' },
          },
          required: ['id', 'authors', 'year', 'title', 'journal'],
        },
      },
    },
    required: ['research', 'citations'],
  },
};

const SYSTEM_PROMPT = `You are a supplement-evidence research assistant. Given a supplement's product name, brand, category, and active ingredients, generate honest evidence-based research using the emit_supplement_research tool.

Rules:
- Write for a generally healthy adult. Do NOT tailor to a specific person's health data.
- Be skeptical. Supplement marketing routinely overstates evidence. Call out when the evidence is weak (n=1 trial, in vitro only, not replicated, low-tier journal).
- NEVER fabricate PMIDs. If you don't know the exact PMID of a real study, omit it — cite author/year/journal/title only. A wrong PMID is far worse than a missing one.
- Anchor claims to specific landmark trials or meta-analyses where possible: Kreider 2017 ISSN position stand for creatine, Jovanovski 2018 AJCN for psyllium lipids, Zhang 2016 Hypertension for magnesium BP, Khan 2021 eClinicalMedicine for omega-3 CV outcomes, Loftfield 2024 JAMA Network Open for multivitamin mortality, REDUCE-IT (Bhatt 2019 NEJM) for icosapent ethyl, etc.
- Include dose context tied to the product's actual serving size when available (active ingredient amounts are passed in the prompt). If the product serving is below the study-effective dose, say so numerically.
- Effect sizes matter. Prefer "-13 mg/dL LDL" over "lowers LDL." Prefer "RR 0.89" over "reduces risk."
- Watch-fors section should include realistic concerns: loose stools for magnesium, TMJ risk for chewing gum products, serum creatinine elevation for creatine, fiber + thyroid med timing, etc.
- Keep research prose between 1000-3000 characters. Dense but scannable.`;

export async function generateSupplementResearch(input: {
  productName: string | null;
  brandName: string | null;
  category: string | null;
  parsed: ParsedNutritionLabel | null;
}): Promise<GeneratedResearch | null> {
  const { productName, brandName, category, parsed } = input;

  if (!productName && !brandName && !category) {
    throw new Error(
      'Cannot generate research without at least a product name, brand, or category.'
    );
  }

  const activeIngredients: string[] = [];
  if (parsed) {
    for (const v of (parsed.vitamins ?? []) as NutrientEntry[]) {
      activeIngredients.push(formatNutrient(v));
    }
    for (const m of (parsed.minerals ?? []) as NutrientEntry[]) {
      activeIngredients.push(formatNutrient(m));
    }
    for (const a of (parsed.otherActive ?? []) as NutrientEntry[]) {
      activeIngredients.push(formatNutrient(a));
    }
  }

  const servingInfo = parsed?.servingSize
    ? `${parsed.servingSize.amount} ${parsed.servingSize.unit}${parsed.servingSize.description ? ` (${parsed.servingSize.description})` : ''}`
    : 'unknown';

  const userText = [
    `Product: ${productName ?? '(unnamed)'}`,
    `Brand: ${brandName ?? '(no brand given)'}`,
    `Category: ${category ?? '(uncategorized)'}`,
    `Serving size: ${servingInfo}`,
    activeIngredients.length > 0
      ? `Active ingredients per serving:\n${activeIngredients.map((a) => '- ' + a).join('\n')}`
      : 'Active ingredients: not parsed',
    '',
    'Generate evidence-based research for this supplement using the emit_supplement_research tool.',
  ].join('\n');

  log.info(`Generating research for ${brandName ?? '?'} / ${productName ?? '?'}`);

  const response = await callClaude({
    system: SYSTEM_PROMPT,
    userContent: [{ type: 'text', text: userText }],
    maxTokens: 4096,
    tools: [RESEARCH_TOOL],
    toolChoice: { type: 'tool', name: 'emit_supplement_research' },
    purpose: 'generate-supplement-research',
  });

  const result = extractToolResult(response) as GeneratedResearch | null;
  if (!result) {
    log.warn('No tool result from Claude for research generation');
    return null;
  }

  return {
    research: String(result.research ?? ''),
    citations: Array.isArray(result.citations)
      ? result.citations.map(normalizeCitation).filter((c): c is NutritionCitation => c !== null)
      : [],
  };
}

function formatNutrient(n: NutrientEntry): string {
  const amount = n.amount != null ? `${n.amount}${n.unit ? ' ' + n.unit : ''}` : '?';
  const form = n.form ? ` (as ${n.form})` : '';
  return `${n.name}${form}: ${amount}`;
}

function normalizeCitation(raw: unknown): NutritionCitation | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Partial<NutritionCitation>;
  if (!c.authors || typeof c.year !== 'number' || !c.title || !c.journal) return null;
  return {
    id: c.id || `${(c.authors || '').split(/\s|,/)[0].toLowerCase()}-${c.year}`,
    pmid: c.pmid,
    doi: c.doi,
    authors: c.authors,
    year: c.year,
    title: c.title,
    journal: c.journal,
    findings: c.findings,
    url: c.url,
  };
}
