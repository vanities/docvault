export type CollectionCounts = { collected: number; failed: number; skipped: number };

/** Bundled collectors (including existing NAS copies) end with a count rollup.
 * Exit zero only means the script finished; failed=N means collection is
 * incomplete. Read the final line before truncating retained output. */
export function collectionCounts(stdout: string): CollectionCounts | null {
  const line = stdout.trim().split('\n').at(-1) ?? '';
  const count = (name: string) => {
    const m = line.match(new RegExp(`(?:^|[ ;])${name}=(\\d+)(?=$|[ ;])`));
    return m ? Number(m[1]) : undefined;
  };
  const failed = count('failed');
  const collected = count('ingested') ?? count('posted') ?? count('uploaded_pdfs');
  if (failed === undefined || collected === undefined) return null;
  return { collected, failed, skipped: count('skipped') ?? 0 };
}
