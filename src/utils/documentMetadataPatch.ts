import type { TaxDocument } from '../types';

/** Send only edited metadata so a tracking change cannot overwrite notes or tags. */
export function documentMetadataPatch(updates: Partial<TaxDocument>) {
  const patch: { tags?: string[]; notes?: string; tracked?: boolean } = {};
  if (updates.tags !== undefined) patch.tags = updates.tags;
  if (updates.notes !== undefined) patch.notes = updates.notes;
  if (updates.tracked !== undefined) patch.tracked = updates.tracked;
  return Object.keys(patch).length ? patch : null;
}
