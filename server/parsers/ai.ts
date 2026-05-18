// AI document parser — delegates to the parser registry.
// The parseWithAI() function signature is unchanged for backward compatibility.
// All route handlers in server/index.ts continue to call parseWithAI(filePath, filename).

import type { ParsedTaxDocument } from './pdf.js';
import { routeParse } from './registry.js';

// Re-export for any code that imports from ai.ts
export { routeParse };

// Parse document via Claude Vision. The 429/5xx retry is handled by the
// Anthropic SDK itself (configured in base.ts), so this layer doesn't need
// its own backoff loop. Delegates to the per-document-type parser registry.
export async function parseWithAI(
  filePath: string,
  filename: string
): Promise<ParsedTaxDocument | null> {
  return routeParse(filePath, filename);
}
