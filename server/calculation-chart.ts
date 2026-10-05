export interface CalculationChart {
  kind: 'line' | 'bar';
  title: string;
  labels: string[];
  series: { name: string; values: number[] }[];
}

/** Validate before rendering, including charts loaded from saved conversations. */
export function readCalculationChart(value: unknown): CalculationChart | null {
  if (!value || typeof value !== 'object') return null;
  const c = value as CalculationChart;
  if (
    !['line', 'bar'].includes(c.kind) ||
    typeof c.title !== 'string' ||
    c.title.length > 200 ||
    !Array.isArray(c.labels) ||
    c.labels.length < 1 ||
    c.labels.length > 100 ||
    !c.labels.every((v) => typeof v === 'string' && v.length <= 100) ||
    !Array.isArray(c.series) ||
    c.series.length < 1 ||
    c.series.length > 4 ||
    !c.series.every(
      (s) =>
        s &&
        typeof s.name === 'string' &&
        s.name.length <= 100 &&
        Array.isArray(s.values) &&
        s.values.length === c.labels.length &&
        s.values.every((v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e100)
    )
  )
    return null;
  return c;
}

export function calculationChartSvg(chart: CalculationChart, compact = false): string {
  const c = readCalculationChart(chart);
  if (!c) throw new Error('Invalid chart');
  const esc = (s: string) =>
    s.replace(
      /[&<>"']/g,
      (v) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[v]!
    );
  const colors = ['#2563eb', '#059669', '#d97706', '#9333ea'];
  const width = compact ? 360 : 660;
  const plotWidth = width - 100;
  const values = c.series.flatMap((s) => s.values);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;
  const y = (v: number) => 270 - ((v - min) / span) * 200;
  const step = plotWidth / c.labels.length;
  const x = (i: number) => 65 + step * (i + 0.5);
  const marks = c.series
    .map((s, j) =>
      c.kind === 'line'
        ? `<polyline fill="none" stroke="${colors[j]}" stroke-width="2" points="${s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')}"/>${s.values.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="3" fill="${colors[j]}"/>`).join('')}`
        : s.values
            .map(
              (v, i) =>
                `<rect x="${65 + step * i + step * 0.1 + (j * step * 0.8) / c.series.length}" y="${Math.min(y(0), y(v))}" width="${(step * 0.8) / c.series.length}" height="${Math.abs(y(v) - y(0))}" fill="${colors[j]}"/>`
            )
            .join('')
    )
    .join('');
  const labels = c.labels
    .map((v, i) =>
      i % Math.max(1, Math.ceil(c.labels.length / (compact ? 3 : 8))) === 0
        ? `<text x="${x(i)}" y="290" text-anchor="middle">${esc(v.slice(0, 14))}</text>`
        : ''
    )
    .join('');
  const ticks = [0, 0.5, 1]
    .map(
      (f) =>
        `<text x="58" y="${y(min + span * f) + 4}" text-anchor="end">${(min + span * f).toPrecision(3)}</text>`
    )
    .join('');
  const legend = c.series
    .map(
      (s, j) =>
        `<text x="${65 + (compact ? j % 2 : j) * (compact ? 135 : 145)}" y="${325 + (compact ? Math.floor(j / 2) * 18 : 0)}" fill="${colors[j]}">${esc(s.name.slice(0, compact ? 18 : 22))}</text>`
    )
    .join('');
  const visibleTitle =
    c.title.length > (compact ? 28 : 60) ? `${c.title.slice(0, compact ? 27 : 59)}…` : c.title;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 350" role="img"><title>${esc(c.title)}</title><rect width="${width}" height="350" fill="white"/><g font-family="sans-serif" font-size="11" fill="#334155"><text x="65" y="35" font-size="17">${esc(visibleTitle)}</text><path d="M65 70V270H${width - 35} M65 ${y(0)}H${width - 35}" fill="none" stroke="#cbd5e1"/>${marks}${labels}${ticks}${legend}</g></svg>`;
}
