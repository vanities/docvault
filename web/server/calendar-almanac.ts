// Native clients use the same calendar math as the web UI, in their own zone.
import {
  astrologyForDate,
  formatClock,
  formatDaylight,
  formatDaylightDelta,
  mercuryStationsByDate,
  moonInfoForDate,
  moonPhasesByDate,
  seasonMarksByDate,
  sunTimesForDate,
} from './astronomy.js';
import { dstTransitionsByDate, meteorShowersByDate, usHolidaysByDate } from './almanac.js';
import { addInterval } from './calendar-recurrence.js';
import type { Settings } from './data.js';
import { isValidTimeZone, zonedNoon, zonedOffsetMinutes } from './tz.js';

export function calendarAlmanac(start: string, end: string, timeZone: string, settings: Settings) {
  const moon = moonPhasesByDate(start, end, timeZone);
  const seasons = seasonMarksByDate(start, end, timeZone);
  const stations = mercuryStationsByDate(start, end, timeZone);
  const meteors = meteorShowersByDate(start, end);
  const holidays = usHolidaysByDate(start, end);
  const dst = dstTransitionsByDate(start, end, (iso) =>
    zonedOffsetMinutes(zonedNoon(iso, timeZone), timeZone)
  );
  const location = settings.weather;
  const sunZone = isValidTimeZone(location?.timezone) ? location.timezone : timeZone;
  const hasCoords =
    typeof location?.latitude === 'number' &&
    typeof location.longitude === 'number' &&
    Math.abs(location.latitude) <= 90 &&
    Math.abs(location.longitude) <= 180;
  const days = [];
  for (let date = start; date <= end; date = addInterval(date, 1, 'day')) {
    const marks: { layer: string; emoji: string; label: string; instant?: Date }[] = [];
    const phase = moon.get(date);
    if (phase) {
      marks.push({
        layer: 'showMoon',
        emoji: phase.supermoon ? '🌝' : phase.emoji,
        label: phase.supermoon ? 'Supermoon (full moon near perigee)' : phase.label,
        instant: phase.instant,
      });
      if (phase.eclipse)
        marks.push({
          layer: 'showMoon',
          emoji: phase.eclipse === 'solar' ? '⚫' : '🔴',
          label: phase.eclipse === 'solar' ? 'Solar eclipse' : 'Lunar eclipse',
        });
    }
    const season = seasons.get(date);
    if (season)
      marks.push({
        layer: 'showSeasons',
        emoji: season.emoji,
        label: season.name,
        instant: season.instant,
      });
    const station = stations.get(date);
    if (station) marks.push({ layer: 'showAstrology', emoji: '☿', label: station.label });
    for (const [layer, source] of [
      ['showMeteors', meteors],
      ['showDst', dst],
    ] as const) {
      const mark = source.get(date);
      if (mark) marks.push({ layer, ...mark });
    }
    const holiday = holidays.get(date);
    if (holiday) marks.push({ layer: 'showHolidays', emoji: '🎉', label: holiday });
    const sun = hasCoords ? sunTimesForDate(date, location!.latitude!, location!.longitude!) : null;
    const previous = hasCoords
      ? sunTimesForDate(addInterval(date, -1, 'day'), location!.latitude!, location!.longitude!)
      : null;
    const daylightSeconds = sun ? (sun.sunset.getTime() - sun.sunrise.getTime()) / 1000 : 0;
    const previousSeconds = previous
      ? (previous.sunset.getTime() - previous.sunrise.getTime()) / 1000
      : 0;
    days.push({
      date,
      marks,
      moon: moonInfoForDate(date, timeZone),
      astrology: astrologyForDate(date, timeZone),
      sun: !hasCoords
        ? null
        : !sun
          ? { polar: true }
          : {
              sunrise: formatClock(sun.sunrise, sunZone),
              sunset: formatClock(sun.sunset, sunZone),
              daylight: formatDaylight(sun.daylightMinutes),
              change: previous ? formatDaylightDelta(daylightSeconds - previousSeconds) : null,
              timeZone: sunZone,
              location: location?.label ?? '',
            },
    });
  }
  return { timeZone, days, display: settings.calendar ?? {} };
}
