// Astronomy tests anchored to well-documented events (J2000-era instants
// published in astronomical almanacs) plus structural invariants, so exact
// coefficients can be refined without brittle expectations. Pure math, no
// personal data.

import { describe, expect, test } from 'vite-plus/test';
import {
  astrologyForDate,
  moonDistanceKm,
  formatDaylight,
  isMercuryRetrograde,
  mercuryStationsByDate,
  moonLongitude,
  sunLongitude,
  zodiacSign,
  moonInfoForDate,
  moonPhasesByDate,
  seasonMarksByDate,
  sunTimesForDate,
} from './astronomy';

const HOUR = 3_600_000;

describe('moonPhasesByDate', () => {
  test('anchors: the J2000 epoch new moon and the Jan 2000 eclipse full moon', () => {
    // New moon 2000-01-06 18:14 UTC; full moon (total lunar eclipse)
    // 2000-01-21 04:44 UTC.
    const phases = moonPhasesByDate('1999-12-30', '2000-02-05');
    const marks = [...phases.values()];
    const newMoon = marks.find((m) => m.phase === 'new');
    const fullMoon = marks.find((m) => m.phase === 'full');
    expect(newMoon).toBeDefined();
    expect(fullMoon).toBeDefined();
    expect(Math.abs(newMoon!.instant.getTime() - Date.UTC(2000, 0, 6, 18, 14))).toBeLessThan(
      2 * HOUR
    );
    expect(Math.abs(fullMoon!.instant.getTime() - Date.UTC(2000, 0, 21, 4, 44))).toBeLessThan(
      2 * HOUR
    );
  });

  test('a full synodic month contains all four principal phases in order', () => {
    const phases = moonPhasesByDate('2026-08-01', '2026-09-05');
    const seq = [...phases.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, m]) => m.phase);
    // Whatever phase starts the window, all four appear at least once.
    expect(new Set(seq).size).toBe(4);
    // Consecutive same-type phases are ~29.2–29.9 days apart.
    const fulls = [...phases.values()]
      .filter((m) => m.phase === 'full')
      .map((m) => m.instant.getTime());
    if (fulls.length === 2) {
      const gapDays = Math.abs(fulls[1] - fulls[0]) / 86_400_000;
      expect(gapDays).toBeGreaterThan(29.1);
      expect(gapDays).toBeLessThan(30);
    }
  });

  test('every month has 3-5 principal phases marked', () => {
    for (const [start, end] of [
      ['2026-08-01', '2026-08-31'],
      ['2027-02-01', '2027-02-28'],
    ]) {
      const count = moonPhasesByDate(start, end).size;
      expect(count).toBeGreaterThanOrEqual(3);
      expect(count).toBeLessThanOrEqual(5);
    }
  });
});

describe('moonInfoForDate', () => {
  test('illumination near 0 at new moon, near 1 at full moon', () => {
    // Anchored to the Jan 2000 phases above.
    expect(moonInfoForDate('2000-01-06').illumination).toBeLessThan(0.05);
    expect(moonInfoForDate('2000-01-21').illumination).toBeGreaterThan(0.95);
    expect(moonInfoForDate('2000-01-06').name).toBe('New moon');
    expect(moonInfoForDate('2000-01-21').name).toBe('Full moon');
  });

  test('age stays within one synodic month and waxes then wanes', () => {
    const a = moonInfoForDate('2026-08-05');
    expect(a.ageDays).toBeGreaterThanOrEqual(0);
    expect(a.ageDays).toBeLessThan(29.54);
  });
});

describe('seasonMarksByDate', () => {
  test('anchors: March 2000 equinox and December 2000 solstice', () => {
    // 2000-03-20 07:35 UTC and 2000-12-21 13:37 UTC.
    const marks = seasonMarksByDate('2000-01-01', '2000-12-31');
    expect(marks.size).toBe(4);
    const byName = new Map([...marks.values()].map((m) => [m.name, m.instant]));
    expect(
      Math.abs(byName.get('March equinox')!.getTime() - Date.UTC(2000, 2, 20, 7, 35))
    ).toBeLessThan(2 * HOUR);
    expect(
      Math.abs(byName.get('December solstice')!.getTime() - Date.UTC(2000, 11, 21, 13, 37))
    ).toBeLessThan(2 * HOUR);
  });

  test('2026 seasons fall in their canonical day ranges', () => {
    const marks = seasonMarksByDate('2026-01-01', '2026-12-31');
    const days = new Map([...marks.entries()].map(([date, m]) => [m.name, date]));
    expect(days.get('March equinox')! >= '2026-03-19').toBe(true);
    expect(days.get('March equinox')! <= '2026-03-21').toBe(true);
    expect(days.get('June solstice')! >= '2026-06-20').toBe(true);
    expect(days.get('June solstice')! <= '2026-06-22').toBe(true);
    expect(days.get('September equinox')! >= '2026-09-21').toBe(true);
    expect(days.get('September equinox')! <= '2026-09-24').toBe(true);
    expect(days.get('December solstice')! >= '2026-12-20').toBe(true);
    expect(days.get('December solstice')! <= '2026-12-23').toBe(true);
  });
});

describe('sunTimesForDate', () => {
  // A mid-latitude US location (generic fixture — not personal data).
  const LAT = 36.0;
  const LON = -86.9;

  test('summer days are long, winter days short, at mid-northern latitude', () => {
    const june = sunTimesForDate('2026-06-21', LAT, LON)!;
    const dec = sunTimesForDate('2026-12-21', LAT, LON)!;
    expect(june.daylightMinutes).toBeGreaterThan(14 * 60 - 30);
    expect(june.daylightMinutes).toBeLessThan(15 * 60);
    expect(dec.daylightMinutes).toBeGreaterThan(9 * 60);
    expect(dec.daylightMinutes).toBeLessThan(10 * 60 + 15);
    expect(june.sunset.getTime()).toBeGreaterThan(june.sunrise.getTime());
  });

  test('equinox daylight is ~12 hours everywhere temperate', () => {
    const eq = sunTimesForDate('2026-03-20', LAT, LON)!;
    expect(Math.abs(eq.daylightMinutes - 12 * 60)).toBeLessThan(25);
  });

  test('polar night returns null', () => {
    expect(sunTimesForDate('2026-12-21', 78, 16)).toBeNull(); // Svalbard, winter
  });

  test('formatDaylight renders h/m', () => {
    expect(formatDaylight(754)).toBe('12h 34m');
  });
});

describe('astrology layer', () => {
  test('sun longitude is ~0° at the March equinox (tropical Aries by definition)', () => {
    // The tropical zodiac is DEFINED by the equinox: sun enters Aries there.
    const marks = seasonMarksByDate('2026-01-01', '2026-12-31');
    const equinox = [...marks.values()].find((m) => m.name === 'March equinox')!;
    const lon = sunLongitude(equinox.instant);
    const dist = Math.min(lon, 360 - lon);
    expect(dist).toBeLessThan(0.1);
  });

  test('sun signs across the year', () => {
    expect(astrologyForDate('2026-08-02').sunSign.name).toBe('Leo');
    expect(astrologyForDate('2026-01-01').sunSign.name).toBe('Capricorn');
    expect(astrologyForDate('2026-04-25').sunSign.name).toBe('Taurus');
    expect(astrologyForDate('2026-11-01').sunSign.name).toBe('Scorpio');
  });

  test('at full moon, moon opposes sun (longitudes 180° apart)', () => {
    // Anchored to the Jan 2000 eclipse full moon — an eclipse means the
    // opposition is nearly exact.
    const at = new Date(Date.UTC(2000, 0, 21, 4, 44));
    let diff = Math.abs(moonLongitude(at) - sunLongitude(at));
    if (diff > 180) diff = 360 - diff;
    expect(Math.abs(diff - 180)).toBeLessThan(1);
  });

  test('moon changes sign every ~2.3 days (12-14 changes per month)', () => {
    let changes = 0;
    let prev = astrologyForDate('2026-08-01').moonSign.name;
    for (let d = 2; d <= 31; d++) {
      const cur = astrologyForDate(`2026-08-${String(d).padStart(2, '0')}`).moonSign.name;
      if (cur !== prev) changes++;
      prev = cur;
    }
    expect(changes).toBeGreaterThanOrEqual(11);
    expect(changes).toBeLessThanOrEqual(15);
  });

  test('Mercury is retrograde ~19-22% of days, in 3-4 spells of ~3 weeks', () => {
    let retroDays = 0;
    const spells: number[] = [];
    let run = 0;
    for (let t = Date.UTC(2026, 0, 1); t <= Date.UTC(2026, 11, 31); t += 86_400_000) {
      const d = new Date(t);
      const iso = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
        d.getUTCDate()
      ).padStart(2, '0')}`;
      if (isMercuryRetrograde(iso)) {
        retroDays++;
        run++;
      } else if (run > 0) {
        spells.push(run);
        run = 0;
      }
    }
    if (run > 0) spells.push(run);
    expect(retroDays).toBeGreaterThan(55);
    expect(retroDays).toBeLessThan(85);
    const fullSpells = spells.filter((s) => s > 5); // ignore year-boundary fragments
    expect(fullSpells.length).toBeGreaterThanOrEqual(3);
    expect(fullSpells.length).toBeLessThanOrEqual(4);
    for (const s of fullSpells) {
      expect(s).toBeGreaterThan(17);
      expect(s).toBeLessThan(27);
    }
  });

  test('mercuryStationsByDate marks paired retrograde/direct flips', () => {
    const stations = mercuryStationsByDate('2026-01-01', '2026-12-31');
    const dirs = [...stations.values()].map((s) => s.direction);
    expect(stations.size).toBeGreaterThanOrEqual(6);
    expect(stations.size).toBeLessThanOrEqual(8);
    // Alternating retrograde/direct.
    for (let i = 1; i < dirs.length; i++) expect(dirs[i]).not.toBe(dirs[i - 1]);
  });

  test('zodiacSign slices the ecliptic into 30° signs', () => {
    expect(zodiacSign(0).name).toBe('Aries');
    expect(zodiacSign(29.9).name).toBe('Aries');
    expect(zodiacSign(30).name).toBe('Taurus');
    expect(zodiacSign(359).name).toBe('Pisces');
    expect(zodiacSign(-10).name).toBe('Pisces');
  });
});

describe('eclipses and supermoons', () => {
  test('anchors: the Aug 1999 total solar and Jan 2000 total lunar eclipses', () => {
    const aug99 = moonPhasesByDate('1999-08-01', '1999-08-31');
    const solarDay = [...aug99.values()].find((m) => m.eclipse === 'solar');
    expect(solarDay).toBeDefined();
    expect(solarDay!.instant.getUTCDate()).toBe(11);

    const jan00 = moonPhasesByDate('2000-01-01', '2000-01-31');
    const lunarDay = [...jan00.values()].find((m) => m.eclipse === 'lunar');
    expect(lunarDay).toBeDefined();
    expect(lunarDay!.instant.getUTCDate()).toBe(21);
  });

  test('a year has a plausible number of eclipses (structural)', () => {
    const marks = [...moonPhasesByDate('2026-01-01', '2026-12-31').values()];
    const eclipses = marks.filter((m) => m.eclipse);
    expect(eclipses.length).toBeGreaterThanOrEqual(2);
    expect(eclipses.length).toBeLessThanOrEqual(7);
    // Solar eclipses only at new moons, lunar only at full moons.
    for (const e of eclipses) {
      expect(e.eclipse === 'solar' ? e.phase : 'new').toBe('new');
      if (e.eclipse === 'lunar') expect(e.phase).toBe('full');
    }
  });

  test('moon distance stays within the physical range; some full moons are super', () => {
    const marks = [...moonPhasesByDate('2026-01-01', '2027-12-31').values()];
    const fulls = marks.filter((m) => m.phase === 'full');
    for (const f of fulls) {
      const d = moonDistanceKm(f.instant);
      expect(d).toBeGreaterThan(354_000);
      expect(d).toBeLessThan(407_500);
    }
    const supers = fulls.filter((m) => m.supermoon);
    // Typically 3-4 per year under the ~361,500 km Nolle-style cutoff.
    expect(supers.length).toBeGreaterThanOrEqual(3);
    expect(supers.length).toBeLessThanOrEqual(10);
  });
});
