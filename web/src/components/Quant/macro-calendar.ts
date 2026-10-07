import calendarJson from '../../data/macro-release-calendar.json?raw';

export interface MacroEvent {
  date: string;
  label: string;
  type: 'fomc' | 'cpi' | 'nfp';
  url: string;
  time: string | null;
}

export const macroReleaseCalendar = JSON.parse(calendarJson) as {
  verifiedAt: string;
  coverage: Record<MacroEvent['type'], string>;
  events: MacroEvent[];
};

// Dates are agency publication days in Eastern Time. Count calendar days,
// without local-midnight or daylight-saving offsets changing the countdown.
export function upcomingMacroEvents(now = new Date(), limit = 5) {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return macroReleaseCalendar.events
    .filter((event) => event.date >= today)
    .slice(0, limit)
    .map((event) => ({
      ...event,
      daysAway: Math.round(
        (Date.parse(`${event.date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000
      ),
    }));
}
