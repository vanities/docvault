const DONUT_COLORS = [
  '#f59e0b', // amber
  '#6366f1', // indigo
  '#22c55e', // green
  '#8b5cf6', // violet
  '#f43f5e', // rose
  '#06b6d4', // cyan
  '#f97316', // orange
  '#3b82f6', // blue
  '#94a3b8', // slate (for "Other")
];

export function getDonutColor(index: number): string {
  return DONUT_COLORS[index % DONUT_COLORS.length];
}
