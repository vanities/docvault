import { expect, test } from 'vite-plus/test';
import { getDocumentPath, getDocumentYear } from './documentDestination';

test('an All Files document keeps its folder year when moved to another type', () => {
  const year = getDocumentYear({ taxYear: 0, filePath: '2024/income/other/Demo.pdf' }, [2026]);
  expect(getDocumentPath('w2', year, 'Demo.pdf')).toBe('2024/income/w2/Demo.pdf');
});
test('a tax-year view keeps its explicit year', () => {
  expect(getDocumentYear({ taxYear: 2023, filePath: 'misc/Demo.pdf' }, [2026])).toBe(2023);
});
test('business documents choose a real default if changed to a year-based type', () => {
  const year = getDocumentYear(
    { taxYear: 0, filePath: 'business-docs/formation/Demo.pdf' },
    [2026]
  );
  expect(getDocumentPath('other', year, 'Demo.pdf')).toBe('2026/income/other/Demo.pdf');
  expect(getDocumentPath('formation', year, 'Demo.pdf')).toBe('business-docs/formation/Demo.pdf');
});
test('a year-looking filename outside a year folder does not become a tax year', () => {
  expect(getDocumentYear({ taxYear: 0, filePath: '1999_Demo.pdf' }, [2026])).toBe(2026);
});
test('missing year options never produce a year-zero destination', () => {
  expect(getDocumentYear({ taxYear: 0 }, [0], 2026)).toBe(2026);
});
