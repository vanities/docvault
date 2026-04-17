// Nutrition-label parser — extracts FDA-standard Supplement Facts / Nutrition
// Facts data from label images using Claude Vision + the shared callClaude
// tool-use pattern. Input: image buffer. Output: structured ParsedNutritionLabel.
//
// History:
//   1.0.0 — initial: serving size, macros, vitamins+minerals with DV, ingredients,
//           proprietary blends, directions, warnings.
//
// Bump PARSER_VERSION when the extraction schema or prompt changes in a way that
// invalidates older parse results.

import { callClaude, extractToolResult } from './base.js';
import type { FileContentBlock } from './base.js';
import { createLogger } from '../logger.js';

const log = createLogger('NutritionParser');

export const NUTRITION_PARSER_VERSION = '1.0.0';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Category buckets used for filtering / grouping in the UI and snapshot.
 * Free-form `category` from the parser is normalized to one of these, with
 * "other" as the catch-all.
 */
export type NutritionCategory =
  | 'multivitamin'
  | 'vitamin'
  | 'mineral'
  | 'fish-oil'
  | 'omega-3'
  | 'fiber'
  | 'psyllium'
  | 'electrolyte'
  | 'sports-drink'
  | 'protein'
  | 'creatine'
  | 'amino-acid'
  | 'herbal'
  | 'adaptogen'
  | 'probiotic'
  | 'other';

/** A single nutrient line from the facts panel. */
export interface NutrientEntry {
  /** Canonical nutrient name, e.g. "Vitamin D", "Magnesium". */
  name: string;
  /** Numeric amount per serving. */
  amount?: number;
  /** Unit — "mg", "mcg", "IU", "g", "%". */
  unit?: string;
  /** % Daily Value (e.g. 117 means 117% DV). */
  dv?: number;
  /** Chemical form if disclosed — "beta-carotene", "bisglycinate", "cholecalciferol". */
  form?: string;
  /** Free-form annotation, e.g. " (as amino acid chelate)" or parser notes. */
  notes?: string;
}

/** Macronutrient block from a Nutrition Facts panel. */
export interface MacroBlock {
  calories?: number;
  totalFat?: NutrientEntry;
  saturatedFat?: NutrientEntry;
  transFat?: NutrientEntry;
  cholesterol?: NutrientEntry;
  sodium?: NutrientEntry;
  totalCarbohydrate?: NutrientEntry;
  dietaryFiber?: NutrientEntry;
  solubleFiber?: NutrientEntry;
  insolubleFiber?: NutrientEntry;
  totalSugars?: NutrientEntry;
  addedSugars?: NutrientEntry;
  sugarAlcohols?: NutrientEntry;
  protein?: NutrientEntry;
}

/** Proprietary blend (common in "Men's / Immunity / Energy" formulas). */
export interface ProprietaryBlend {
  name: string;
  totalAmount?: { amount: number; unit: string };
  ingredients?: string[];
}

/** Structured output from the parser — everything it could extract from the label. */
export interface ParsedNutritionLabel {
  schemaVersion: 1;
  parserVersion: string;
  productName?: string;
  brandName?: string;
  /** Parser-assigned category bucket. */
  category?: NutritionCategory;
  servingSize?: {
    amount: number;
    unit: string;
    description?: string;
  };
  /** Sometimes labels say "about 90" — we preserve either number or string. */
  servingsPerContainer?: number | string;
  macros?: MacroBlock;
  vitamins?: NutrientEntry[];
  minerals?: NutrientEntry[];
  /** Amino acids, herbal extracts, creatine, taurine, lutein, etc. */
  otherActive?: NutrientEntry[];
  proprietaryBlends?: ProprietaryBlend[];
  /** The "Other Ingredients" list (excipients, flavors, colors). */
  ingredients?: string[];
  allergenInfo?: string[];
  directions?: string;
  warnings?: string[];
  /** Confidence signal from the parser (0–1). Null if not self-reported. */
  confidence?: number;
  /** Freeform field for anything the parser wants to flag to a reviewer. */
  parserNotes?: string;
}

// ---------------------------------------------------------------------------
// Tool schema — forces Claude to return structured data (no JSON-parsing risk)
// ---------------------------------------------------------------------------

const NUTRIENT_ENTRY_SCHEMA = {
  type: 'object' as const,
  properties: {
    name: { type: 'string', description: 'Nutrient name (e.g. "Vitamin D", "Magnesium")' },
    amount: { type: 'number', description: 'Numeric amount per serving' },
    unit: { type: 'string', description: 'Unit — mg, mcg, IU, g, %' },
    dv: { type: 'number', description: '% Daily Value as a number (e.g. 117 for 117% DV)' },
    form: {
      type: 'string',
      description: 'Chemical form if disclosed (e.g. "cholecalciferol", "bisglycinate")',
    },
    notes: { type: 'string', description: 'Any extra annotation' },
  },
  required: ['name'],
};

const LABEL_TOOL = {
  name: 'extract_nutrition_label',
  description: 'Extract structured data from a Supplement Facts or Nutrition Facts label image.',
  input_schema: {
    type: 'object' as const,
    properties: {
      productName: {
        type: 'string',
        description: 'Product name visible on the label (e.g. "Opti-Men", "Basic Nutrients 2/Day")',
      },
      brandName: {
        type: 'string',
        description: 'Brand name if shown (e.g. "Thorne", "Optimum Nutrition", "Konsyl")',
      },
      category: {
        type: 'string',
        enum: [
          'multivitamin',
          'vitamin',
          'mineral',
          'fish-oil',
          'omega-3',
          'fiber',
          'psyllium',
          'electrolyte',
          'sports-drink',
          'protein',
          'creatine',
          'amino-acid',
          'herbal',
          'adaptogen',
          'probiotic',
          'other',
        ],
        description:
          'Best-fit category bucket. Use "multivitamin" for broad vitamin+mineral blends, "omega-3" or "fish-oil" for EPA/DHA products, "fiber" or "psyllium" for bulk-forming fiber. When uncertain use "other".',
      },
      servingSize: {
        type: 'object',
        properties: {
          amount: { type: 'number', description: 'Numeric serving amount' },
          unit: {
            type: 'string',
            description: 'Unit of serving (e.g. "capsule", "tablet", "tsp", "Tbsp", "g", "ml")',
          },
          description: {
            type: 'string',
            description:
              'Full serving description as shown (e.g. "3 tablets", "2 rounded teaspoons (11.6g)")',
          },
        },
        required: ['amount', 'unit'],
      },
      servingsPerContainer: {
        type: ['number', 'string'],
        description:
          'Servings per container. May be a number (30) or approximate string ("about 90").',
      },
      macros: {
        type: 'object',
        description:
          'Macronutrient / Nutrition Facts block. Only include fields the label shows. For Supplement Facts labels that have no macro panel, omit this entirely.',
        properties: {
          calories: { type: 'number' },
          totalFat: NUTRIENT_ENTRY_SCHEMA,
          saturatedFat: NUTRIENT_ENTRY_SCHEMA,
          transFat: NUTRIENT_ENTRY_SCHEMA,
          cholesterol: NUTRIENT_ENTRY_SCHEMA,
          sodium: NUTRIENT_ENTRY_SCHEMA,
          totalCarbohydrate: NUTRIENT_ENTRY_SCHEMA,
          dietaryFiber: NUTRIENT_ENTRY_SCHEMA,
          solubleFiber: NUTRIENT_ENTRY_SCHEMA,
          insolubleFiber: NUTRIENT_ENTRY_SCHEMA,
          totalSugars: NUTRIENT_ENTRY_SCHEMA,
          addedSugars: NUTRIENT_ENTRY_SCHEMA,
          sugarAlcohols: NUTRIENT_ENTRY_SCHEMA,
          protein: NUTRIENT_ENTRY_SCHEMA,
        },
      },
      vitamins: {
        type: 'array',
        description:
          'All vitamin rows (A, C, D, E, K, B1–B12, folate, biotin, pantothenic acid, choline).',
        items: NUTRIENT_ENTRY_SCHEMA,
      },
      minerals: {
        type: 'array',
        description:
          'All mineral rows (calcium, iron, magnesium, zinc, selenium, copper, manganese, chromium, molybdenum, iodine, potassium, phosphorus, etc.).',
        items: NUTRIENT_ENTRY_SCHEMA,
      },
      otherActive: {
        type: 'array',
        description:
          'Active ingredients that are not vitamins or minerals — amino acids, creatine, taurine, EPA/DHA, lutein, zeaxanthin, alpha-lipoic acid, CoQ10, lycopene, herbal extracts listed with amounts.',
        items: NUTRIENT_ENTRY_SCHEMA,
      },
      proprietaryBlends: {
        type: 'array',
        description:
          '"Proprietary Blend" rows that show a total amount but a list of ingredients without individual amounts. Example: "Viri Men Blend 50mg: Panax Ginseng, Nettle, Ginkgo Biloba, Saw Palmetto, Oyster Extract".',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Blend name (e.g. "Viri Men Blend")' },
            totalAmount: {
              type: 'object',
              properties: {
                amount: { type: 'number' },
                unit: { type: 'string' },
              },
              required: ['amount', 'unit'],
            },
            ingredients: {
              type: 'array',
              items: { type: 'string' },
              description: 'Individual ingredient names listed within the blend',
            },
          },
          required: ['name'],
        },
      },
      ingredients: {
        type: 'array',
        description:
          'The "Other Ingredients" list (capsule material, fillers, flavors, colors). NOT the active ingredients above.',
        items: { type: 'string' },
      },
      allergenInfo: {
        type: 'array',
        description:
          'Allergen callouts — "Contains: milk, soy, fish" or "This product may cause allergic reactions in people sensitive to X".',
        items: { type: 'string' },
      },
      directions: {
        type: 'string',
        description: 'Dosing instructions as shown on the label (verbatim).',
      },
      warnings: {
        type: 'array',
        description:
          'Warning text — medical warnings, pregnancy cautions, choking hazards, storage notes.',
        items: { type: 'string' },
      },
      confidence: {
        type: 'number',
        description:
          'Self-reported confidence 0–1 that the extraction captured the label accurately. Lower this when the label is blurry, partially cut off, in an unusual format, or when you had to guess values.',
      },
      parserNotes: {
        type: 'string',
        description:
          'Anything a human reviewer should know — label quality issues, ambiguous fields, unusual units.',
      },
    },
  },
};

const SYSTEM_PROMPT = `You extract data from Supplement Facts and Nutrition Facts label images using the extract_nutrition_label tool.

RULES:
- Every nutrient row must become a NutrientEntry with name + amount + unit. Include %DV as a number ("117" not "117%") when shown.
- For Supplement Facts labels: put vitamins in the "vitamins" array, minerals in "minerals", and everything else with an explicit amount in "otherActive" (amino acids, creatine, EPA/DHA, herbal extracts, lutein, etc.).
- For Nutrition Facts labels (food/drink): fill the "macros" block (calories, fat, carb, protein, etc.). Do NOT duplicate macros into the vitamins/minerals arrays.
- Preserve chemical forms in the "form" field. Examples: "Magnesium (as Magnesium Bisglycinate)" → name: "Magnesium", form: "bisglycinate". "Vitamin D3 (as Cholecalciferol)" → name: "Vitamin D3", form: "cholecalciferol". "Vitamin A (as Beta Carotene + Retinyl Palmitate)" → keep both in "form" joined by " + ".
- "Proprietary Blend" rows (ingredients listed together under one total mass) go in "proprietaryBlends" with their ingredient list as strings — don't try to apportion the total across ingredients.
- The "ingredients" array is for "Other Ingredients" (capsule material, fillers, colorants) — NOT the active ingredients above.
- All amounts are numbers, not strings. If the label says "< 1g" or "Less than 1", use 0 and note in "notes".
- If a numeric value is illegible or missing, omit the field rather than guessing.
- Set category to the best-fit bucket. If the label is for a fiber supplement like psyllium, use "psyllium". If it's a fish-oil/omega-3 supplement, use "omega-3". If it's a broad multivitamin, use "multivitamin". When truly unsure, use "other".
- Self-report a confidence score 0–1. Below 0.8 signals a likely-needs-review label.`;

// ---------------------------------------------------------------------------
// Public parse function
// ---------------------------------------------------------------------------

/**
 * Claude Vision's image-input hard limit. Base64 encoding inflates bytes by
 * ~33%, so a 3.75 MB raw image becomes ~5 MB base64 — roughly the ceiling.
 * We reject at 3.5 MB raw to leave headroom and give the user a clean error
 * instead of a 400 from the API several seconds later.
 */
const MAX_RAW_IMAGE_BYTES = 3.5 * 1024 * 1024;

/**
 * Parse a nutrition-label image into structured data. Accepts a raw image
 * buffer + its MIME type.
 *
 * Returns null only when Claude responded successfully but the response
 * didn't contain the expected tool_use block (rare — usually means the
 * model decided the image wasn't a nutrition label). Throws on everything
 * else so the caller can surface the real error to the user (API failures,
 * image size limits, auth issues, network timeouts, rate-limit exhaustion).
 *
 * Supported media types: image/png, image/jpeg, image/gif, image/webp.
 */
export async function parseNutritionLabel(
  imageBuffer: Buffer,
  mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
): Promise<ParsedNutritionLabel | null> {
  if (imageBuffer.length > MAX_RAW_IMAGE_BYTES) {
    const mb = (imageBuffer.length / 1024 / 1024).toFixed(1);
    throw new Error(
      `Image too large: ${mb} MB exceeds the 3.5 MB limit for Claude Vision. ` +
        `Resize in Preview (Export → Quality 85%) or use a JPEG instead of PNG, then re-upload.`
    );
  }

  const fileContent: FileContentBlock = {
    type: 'image' as const,
    source: {
      type: 'base64' as const,
      media_type: mediaType,
      data: imageBuffer.toString('base64'),
    },
  };

  log.info(`Parsing nutrition label (${mediaType}, ${imageBuffer.length} bytes)`);

  const response = await callClaude({
    system: SYSTEM_PROMPT,
    userContent: [
      fileContent,
      {
        type: 'text',
        text: 'Extract all data from this nutrition/supplement label using the extract_nutrition_label tool.',
      },
    ],
    maxTokens: 4096,
    tools: [LABEL_TOOL],
    toolChoice: { type: 'tool', name: 'extract_nutrition_label' },
    purpose: 'parse-nutrition-label',
  });

  const result = extractToolResult(response) as Record<string, unknown> | null;
  if (!result) {
    log.warn('No tool result from Claude — likely not a nutrition label');
    return null;
  }

  return {
    ...result,
    schemaVersion: 1,
    parserVersion: NUTRITION_PARSER_VERSION,
  } as ParsedNutritionLabel;
}
