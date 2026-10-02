import { expect, test } from 'vite-plus/test';
import { documentMetadataPatch } from './documentMetadataPatch';

test('excluding a document persists false without resending its other metadata', () => {
  expect(documentMetadataPatch({ tracked: false })).toEqual({ tracked: false });
});
test('notes can be cleared and tags replaced independently', () => {
  expect(documentMetadataPatch({ notes: '' })).toEqual({ notes: '' });
  expect(documentMetadataPatch({ tags: [] })).toEqual({ tags: [] });
});
test('unrelated edits and undefined fields do not write metadata', () => {
  expect(documentMetadataPatch({ type: 'other' })).toBeNull();
  expect(
    documentMetadataPatch({ notes: undefined, tags: undefined, tracked: undefined })
  ).toBeNull();
});
