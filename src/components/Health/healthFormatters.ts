// Shared value formatters for Health segment views. Extracted from
// HealthChart.tsx because eslint-plugin-react's `only-export-components`
// rule objects to exporting non-component helpers alongside a component
// (it fights React Fast Refresh).

export function formatInt(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return Math.round(value).toLocaleString();
}

export function formatDecimal1(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return value.toFixed(1);
}

export function formatMinutes(value: number): string {
  if (!Number.isFinite(value) || value === 0) return '0m';
  const h = Math.floor(value / 60);
  const m = Math.round(value % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function formatHours(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return `${value.toFixed(1)}h`;
}

export function formatBpm(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return `${Math.round(value)} bpm`;
}
