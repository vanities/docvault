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

/**
 * Split a HealthKit-style camelCase identifier into space-separated words
 * so it wraps naturally in tight layouts. Examples:
 *   TraditionalStrengthTraining → "Traditional Strength Training"
 *   HighIntensityIntervalTraining → "High Intensity Interval Training"
 *   Running → "Running"
 *   Unknown → "Unknown"
 * Acronyms of 2+ uppercase letters stay glued (e.g. HIIT → "HIIT").
 */
export function humanizeTypeName(name: string): string {
  if (!name) return name;
  // Insert a space before a capital letter that follows a lowercase letter
  // (...Strength|Training), and before a capital that precedes a lowercase
  // inside a run of caps (e.g. HIIT|Workout). This is the classic two-pass
  // "split camelCase" regex and it handles both normal camelCase and mixed
  // acronym cases correctly.
  return name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
}
