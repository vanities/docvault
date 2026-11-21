// Every date the app fills in for "today" must come from here, not from
// toISOString(). That reports the UTC day, which in US time zones rolls over at
// 6 to 8 PM, so evening entries (mileage trips, sales, invoices) were saved
// under the next day. localDate.test.ts fails if the UTC pattern comes back.

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

export function todayISO(): string {
  return toISODate(new Date());
}
