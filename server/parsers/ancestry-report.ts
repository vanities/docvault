// Ancestry ethnicity-report parser — vision-based extraction of regions and
// ancestral journeys from a consumer DNA provider (AncestryDNA, 23andMe,
// MyHeritage) results screenshot or PDF export.
//
// Design notes:
//   - This is a single-shot vision call with tool_use enforcing the JSON shape.
//     Mirrors server/parsers/nutrition-label.ts — same shared helpers from
//     parsers/base.ts (bufferToFileData, buildFileContent, callClaude).
//   - Provider-agnostic on purpose. The schema accepts any of the three major
//     consumer services; the model decides which based on visible logo/styling.
//   - No deterministic fallback. Unlike the raw-SNP DNA parser which is pure
//     TypeScript, an ethnicity report only exists as a rendered UI (percentages
//     + region names laid out visually). There is no raw-data export available
//     from Ancestry.com for this particular view, so AI extraction is the only
//     viable path.
//
// Called by: server/routes/ancestry.ts

import {
  bufferToFileData,
  buildFileContent,
  callClaude,
  extractToolResult,
  type MediaType,
} from './base.js';
import { createLogger } from '../logger.js';

const log = createLogger('parser:ancestry');

export interface AncestryRegion {
  /** Parent heading as shown on the page (broad geographic cluster). */
  group: string;
  /** Specific region label under that heading. */
  name: string;
  /** Integer percentage 0–100 as displayed on the page. */
  percentage: number;
}

export interface AncestryJourney {
  /** Top-level journey / community name. */
  name: string;
  /** Indented sub-communities listed under that journey. */
  subregions: string[];
}

export interface AncestryReport {
  source: 'ancestry' | '23andme' | 'myheritage' | 'unknown';
  /**
   * Name printed on the report (usually at top of page). Stored so re-uploads
   * for a different family member are easy to detect. Only ever written into
   * the encrypted results blob — never into plaintext metadata.
   */
  subjectName: string | null;
  regions: AncestryRegion[];
  journeys: AncestryJourney[];
}

// The tool schema is what Claude writes into. `tool_choice: { type: 'tool' }`
// forces it to call this exact tool, so we get back well-formed JSON without
// parsing free text. Same approach every other document parser in this repo
// uses.
const ANCESTRY_TOOL = {
  name: 'extract_ancestry_report',
  description:
    'Extract structured ethnicity regions and ancestral journeys from a consumer DNA provider results page (AncestryDNA, 23andMe, MyHeritage, etc).',
  input_schema: {
    type: 'object' as const,
    properties: {
      source: {
        type: 'string',
        enum: ['ancestry', '23andme', 'myheritage', 'unknown'],
        description:
          'Which consumer DNA service this report is from, inferred from logo or visual styling. Use "unknown" if not identifiable.',
      },
      subjectName: {
        type: ['string', 'null'],
        description:
          'The person name shown on the report header (e.g. displayed next to the donut chart). Null if not visible.',
      },
      regions: {
        type: 'array',
        description:
          'Every ethnicity region with its parent group and percentage. Include all rows even if the percentage is 1%. Do not fabricate percentages — if a row lists no percent, omit it.',
        items: {
          type: 'object',
          properties: {
            group: {
              type: 'string',
              description:
                'Parent heading as shown on the page — e.g. "Scandinavia", "Iberian Peninsula", "East Asia", "Sub-Saharan Africa", "Middle East". This is the bold heading above a set of regions, not the specific region name.',
            },
            name: {
              type: 'string',
              description:
                'Specific region label as shown — e.g. "Sweden & Denmark", "Basque", "Japan & Korea", "Yoruba". Keep the exact wording, including ampersands and special characters.',
            },
            percentage: {
              type: 'number',
              description:
                'Percentage as shown (0–100). If "<1%" is displayed, use 1. Always a whole number unless a decimal is explicitly rendered.',
            },
          },
          required: ['group', 'name', 'percentage'],
        },
      },
      journeys: {
        type: 'array',
        description:
          '"Ancestral Journeys" or "Communities" sections — named migration groups with indented sub-communities.',
        items: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description:
                'Top-level journey/community name as shown (e.g. a named migration group or regional community label).',
            },
            subregions: {
              type: 'array',
              description:
                'Indented sub-communities listed beneath the journey. Preserve pipes, ampersands, and special characters exactly.',
              items: { type: 'string' },
            },
          },
          required: ['name', 'subregions'],
        },
      },
    },
    required: ['source', 'subjectName', 'regions', 'journeys'],
  },
} as const;

const SYSTEM_PROMPT = `You are extracting structured data from a consumer DNA ethnicity/ancestry report.

The image will typically be a screenshot or PDF from AncestryDNA, 23andMe, or MyHeritage showing:
- A donut or pie chart summary
- The subject's name
- Grouped regions with percentages (e.g. a continent/cluster heading followed by indented specific regions with a percent value)
- Optionally an "Ancestral Journeys" or "Communities" section with named migrations and indented sub-communities

Rules:
- Extract every visible region and its percentage. Small regions (1%, 2%) are real — include them.
- Group headings (broader categories) belong in the "group" field, specific region names in "name".
- Do not invent data. If a percentage is not shown, omit the row.
- Preserve wording exactly, including special characters, pipes, accents.
- If the report is not a recognizable ethnicity estimate, call the tool with empty regions and journeys arrays.`;

/**
 * Parse an uploaded ethnicity report image/PDF into structured regions+journeys.
 *
 * Returns null only when Claude responded successfully but the response didn't
 * contain the expected tool_use block (rare — usually means the model decided
 * the image wasn't an ethnicity report). Throws on network/auth errors so the
 * route layer can surface the real error to the user.
 *
 * Supported media types match parsers/base.ts MediaType: PNG, JPEG, GIF, WEBP,
 * plus PDF (Claude's messages API accepts PDFs as a document content block).
 */
export async function parseAncestryReport(
  buffer: Buffer,
  mediaType: MediaType
): Promise<AncestryReport | null> {
  const fileData = await bufferToFileData(buffer, mediaType);
  const fileContent = buildFileContent(fileData);

  log.info(`Parsing ancestry report (${fileData.mediaType})`);

  const response = await callClaude({
    system: SYSTEM_PROMPT,
    userContent: [
      fileContent,
      {
        type: 'text',
        text: 'Extract all ethnicity regions and any ancestral journeys from this report using the extract_ancestry_report tool.',
      },
    ],
    maxTokens: 2048,
    tools: [ANCESTRY_TOOL],
    toolChoice: { type: 'tool', name: 'extract_ancestry_report' },
    purpose: 'parse-ancestry-report',
  });

  const result = extractToolResult(response) as AncestryReport | null;
  if (!result) {
    log.warn('No tool result from Claude — likely not an ancestry report');
    return null;
  }

  // Defensive: ensure the arrays exist even if Claude somehow emitted the
  // keys with wrong types. Downstream code trusts that these are arrays.
  return {
    source: result.source ?? 'unknown',
    subjectName: result.subjectName ?? null,
    regions: Array.isArray(result.regions) ? result.regions : [],
    journeys: Array.isArray(result.journeys) ? result.journeys : [],
  };
}
