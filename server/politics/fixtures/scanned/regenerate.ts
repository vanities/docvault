// Regenerate the frozen `ScanObservation` fixtures from the committed scanned
// House PTR PDFs. Run this when the extraction logic changes:
//
//   bun server/politics/fixtures/scanned/regenerate.ts
//
// It needs poppler-utils (`pdftoppm`) + `tesseract` on PATH — the SAME impure
// extraction the runtime uses. The emitted `<name>.observation.json` is then the
// deterministic input to scanned-house-ptr.test.ts (no binaries needed in CI).
//
// PDFs here are public, non-personal congressional disclosures (safe to commit).

import { readFile, readdir, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { extractScannedHouseObservation } from '../../scanned-house-ptr.js';

const here = dirname(fileURLToPath(import.meta.url));

const pdfs = (await readdir(here)).filter((f) => f.endsWith('.pdf')).sort();
for (const pdf of pdfs) {
  const bytes = await readFile(join(here, pdf));
  const obs = await extractScannedHouseObservation(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  );
  const out = join(here, pdf.replace(/\.pdf$/, '.observation.json'));
  await writeFile(out, JSON.stringify(obs, null, 2) + '\n');
  console.log(`${pdf} → ${obs.rows.length} rows → ${out.split('/').pop()}`);
}
