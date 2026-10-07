// OCR tooling availability for scanned-disclosure recovery. The actual scanned
// House PTR reader lives in scanned-house-ptr.ts (gridline detection + per-cell
// pixel-darkness); this just gates it on the rasterizer + OCR engine being present
// so local dev without poppler/tesseract degrades cleanly to "needs attention".

import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const PDFTOPPM = process.env.PDFTOPPM_BIN ?? 'pdftoppm';
const TESSERACT = process.env.TESSERACT_BIN ?? 'tesseract';

function isMissing(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  return code === 'ENOENT' || /ENOENT|not found/i.test(err instanceof Error ? err.message : '');
}

/** True only if BOTH pdftoppm and tesseract are callable. A non-zero exit (e.g.
 *  `-v` quirks) still means the binary exists; only ENOENT counts as missing. */
export async function ocrAvailable(): Promise<boolean> {
  try {
    await execFileAsync(PDFTOPPM, ['-v'], { timeout: 5000 });
  } catch (err) {
    if (isMissing(err)) return false;
  }
  try {
    await execFileAsync(TESSERACT, ['--version'], { timeout: 5000 });
  } catch (err) {
    if (isMissing(err)) return false;
  }
  return true;
}
