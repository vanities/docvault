import { describe, expect, test } from 'vite-plus/test';
import { browseFiles } from './fileBrowser';

const files = [
  'README.md',
  'Projects/Overview.md',
  'Projects/Planning/Checklist.md',
  'Projects/Planning/Notes.md',
  'Projects-old/Archive.md',
];

describe('source folder browsing', () => {
  test('lists immediate folders with descendant counts and direct files', () => {
    expect(browseFiles(files, '', '')).toEqual({
      folders: [
        { name: 'Projects', path: 'Projects', count: 3 },
        { name: 'Projects-old', path: 'Projects-old', count: 1 },
      ],
      files: ['README.md'],
    });
    expect(browseFiles(files, 'Projects', '')).toEqual({
      folders: [{ name: 'Planning', path: 'Projects/Planning', count: 2 }],
      files: ['Projects/Overview.md'],
    });
  });
  test('search spans the source even when inside another folder', () => {
    expect(browseFiles(files, 'Projects/Planning', '  ARCHIVE ')).toEqual({
      folders: [],
      files: ['Projects-old/Archive.md'],
    });
    expect(browseFiles(files, '', 'Planning').files).toHaveLength(2);
  });
  test('empty and nonexistent folders are empty without leaking prefix matches', () => {
    expect(browseFiles([], '', '')).toEqual({ folders: [], files: [] });
    expect(browseFiles(files, 'Project', '')).toEqual({ folders: [], files: [] });
  });
});
