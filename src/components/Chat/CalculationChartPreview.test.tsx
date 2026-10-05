import { expect, test } from 'vite-plus/test';
import { renderToStaticMarkup } from 'react-dom/server';
import { CalculationChartPreview } from './CalculationChartPreview';

test('renders a downloadable chart from a tool result and ignores invalid charts', () => {
  const html = renderToStaticMarkup(
    <CalculationChartPreview
      result={{
        chart: {
          kind: 'bar',
          title: 'Synthetic chart',
          labels: ['A', 'B'],
          series: [{ name: 'Values', values: [1, 2] }],
        },
      }}
    />
  );
  expect(html).toContain('alt="Synthetic chart"');
  expect(html).toContain('download="calculation-chart.svg"');
  expect(html).toContain('data:image/svg+xml');
  expect(
    renderToStaticMarkup(<CalculationChartPreview result={{ chart: { kind: 'script' } }} />)
  ).toBe('');
});
