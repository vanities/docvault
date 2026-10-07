import { readCalculationChart, calculationChartSvg } from '../../../server/calculation-chart';

export function CalculationChartPreview({ result }: { result: unknown }) {
  const chart =
    result && typeof result === 'object' && 'chart' in result
      ? readCalculationChart(result.chart)
      : null;
  if (!chart) return null;
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(calculationChartSvg(chart))}`;
  const compactUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(calculationChartSvg(chart, true))}`;
  return (
    <figure className="px-3 pb-3">
      <picture>
        <source media="(max-width: 600px)" srcSet={compactUrl} />
        <img src={url} alt={chart.title} className="w-full rounded border border-border/40" />
      </picture>
      <figcaption className="mt-1 flex justify-between gap-2 text-surface-600">
        <span className="min-w-0 break-words">{chart.title}</span>
        <a
          href={url}
          download="calculation-chart.svg"
          className="shrink-0 text-accent-600 underline"
        >
          Download SVG
        </a>
      </figcaption>
    </figure>
  );
}
