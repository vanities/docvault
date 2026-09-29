import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test, vi } from 'vite-plus/test';
import { PortfolioChanges } from './PortfolioChanges';
import { HoldingChanges } from './HoldingChanges';
import type { PortfolioSnapshot } from '../../types';

const privacy = vi.hoisted(() => ({ blurNumbers: false }));
vi.mock('../../contexts/AppContext', () => ({ useAppContext: () => privacy }));

const snapshot = (date: string, totalValue: number): PortfolioSnapshot => ({
  date,
  totalValue,
  cryptoValue: 0,
  brokerValue: totalValue,
  shortTermGains: 0,
  longTermGains: 0,
});

describe('portfolio change columns', () => {
  test('renders all periods, signed dollar and percent values, and missing history', () => {
    privacy.blurNumbers = false;
    const html = renderToStaticMarkup(
      <PortfolioChanges
        snapshots={[snapshot('2025-01-02', 1200), snapshot('2025-01-01', 1000)]}
        rows={[{ key: 'totalValue', label: 'Portfolio' }]}
      />
    );
    for (const text of [
      '1D',
      '7D',
      '1M',
      '+$200.00',
      '+20.00%',
      'As of 2025-01-02',
      '—',
      'overflow-x-auto',
    ])
      expect(html).toContain(text);
  });

  test('hides both money and percentages under the existing privacy toggle', () => {
    privacy.blurNumbers = true;
    const html = renderToStaticMarkup(
      <PortfolioChanges
        snapshots={[snapshot('2025-01-02', 1200), snapshot('2025-01-01', 1000)]}
        rows={[{ key: 'totalValue', label: 'Portfolio' }]}
      />
    );
    expect(html.match(/blur-sm select-none/g)).toHaveLength(3);
    // Tooltips contain dates only, never unblurred personal amounts.
    expect(html.match(/title="[^"]*\$[^"]*"/g)).toBeNull();
    privacy.blurNumbers = false;
  });

  test('old cached quotes render as unavailable until refreshed', () => {
    const html = renderToStaticMarkup(<HoldingChanges quote={undefined} quantity={5} />);
    expect(html.match(/—/g)).toHaveLength(6);
    expect(html).not.toContain('NaN');
  });
});
