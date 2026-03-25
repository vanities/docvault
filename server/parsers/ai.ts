// AI document parser — delegates to the parser registry.
// The parseWithAI() function signature is unchanged for backward compatibility.
// All route handlers in server/index.ts continue to call parseWithAI(filePath, filename).

import type { ParsedTaxDocument } from './pdf.js';
import { routeParse } from './registry.js';

// Re-export for any code that imports from ai.ts
export { routeParse };

// Parse document using Claude Vision API (rate-limited + retry on 429)
// This is the original integration point — delegates to the parser registry.
export async function parseWithAI(
  filePath: string,
  filename: string
): Promise<ParsedTaxDocument | null> {
  return routeParse(filePath, filename);
}
