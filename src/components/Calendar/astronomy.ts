// Astronomy layer for the Calendar — pure math, no API, no storage.
// Moon phases and solstices/equinoxes use Jean Meeus' algorithms
// ("Astronomical Algorithms" ch. 49 and 27, truncated series), accurate to
// well under an hour — far tighter than the day-level display needs.
// Sunrise/sunset uses the classic Almanac for Computers algorithm (±2 min).
// Instants are computed in UTC and assigned to LOCAL calendar days via the
// browser timezone, matching how the user experiences "the full moon is
// Tuesday".

const SYNODIC_MONTH = 29.530588861;
const DEG = Math.PI / 180;
// Julian Date of the Unix epoch.
const JD_UNIX_EPOCH = 2440587.5;

function jdeToDate(jde: number): Date {
  return new Date((jde - JD_UNIX_EPOCH) * 86_400_000);
}

function localISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Moon phases (Meeus ch. 49)
// ---------------------------------------------------------------------------

export type PrincipalPhase = 'new' | 'first-quarter' | 'full' | 'last-quarter';

export interface MoonPhaseMark {
  phase: PrincipalPhase;
  emoji: string;
  label: string;
  instant: Date;
}

export const PHASE_META: Record<PrincipalPhase, { emoji: string; label: string }> = {
  new: { emoji: '🌑', label: 'New moon' },
  'first-quarter': { emoji: '🌓', label: 'First quarter' },
  full: { emoji: '🌕', label: 'Full moon' },
  'last-quarter': { emoji: '🌗', label: 'Last quarter' },
};

/** Instant of the lunar phase at series index k (integer = new moon,
 * +0.25 first quarter, +0.5 full, +0.75 last quarter). */
function phaseInstant(k: number): Date {
  const T = k / 1236.85;
  let jde =
    2451550.09766 +
    SYNODIC_MONTH * k +
    0.00015437 * T * T -
    0.00000015 * T * T * T +
    0.00000000073 * T * T * T * T;

  const E = 1 - 0.002516 * T - 0.0000074 * T * T;
  const M = (2.5534 + 29.1053567 * k - 0.0000014 * T * T) * DEG; // sun mean anomaly
  const Mp = (201.5643 + 385.81693528 * k + 0.0107582 * T * T + 0.00001238 * T * T * T) * DEG; // moon
  const F = (160.7108 + 390.67050284 * k - 0.0016118 * T * T - 0.00000227 * T * T * T) * DEG;
  const O = (124.7746 - 1.56375588 * k + 0.0020672 * T * T) * DEG;

  const frac = ((k % 1) + 1) % 1;
  const { sin, cos } = Math;

  if (frac < 0.01 || frac > 0.99) {
    // New moon
    jde +=
      -0.4072 * sin(Mp) +
      0.17241 * E * sin(M) +
      0.01608 * sin(2 * Mp) +
      0.01039 * sin(2 * F) +
      0.00739 * E * sin(Mp - M) -
      0.00514 * E * sin(Mp + M) +
      0.00208 * E * E * sin(2 * M) -
      0.00111 * sin(Mp - 2 * F) -
      0.00057 * sin(Mp + 2 * F) +
      0.00056 * E * sin(2 * Mp + M) -
      0.00042 * sin(3 * Mp) +
      0.00042 * E * sin(M + 2 * F) +
      0.00038 * E * sin(M - 2 * F) -
      0.00024 * E * sin(2 * Mp - M) -
      0.00017 * sin(O);
  } else if (Math.abs(frac - 0.5) < 0.01) {
    // Full moon
    jde +=
      -0.40614 * sin(Mp) +
      0.17302 * E * sin(M) +
      0.01614 * sin(2 * Mp) +
      0.01043 * sin(2 * F) +
      0.00734 * E * sin(Mp - M) -
      0.00515 * E * sin(Mp + M) +
      0.00209 * E * E * sin(2 * M) -
      0.00111 * sin(Mp - 2 * F) -
      0.00057 * sin(Mp + 2 * F) +
      0.00056 * E * sin(2 * Mp + M) -
      0.00042 * sin(3 * Mp) +
      0.00042 * E * sin(M + 2 * F) +
      0.00038 * E * sin(M - 2 * F) -
      0.00024 * E * sin(2 * Mp - M) -
      0.00017 * sin(O);
  } else {
    // Quarters
    jde +=
      -0.62801 * sin(Mp) +
      0.17172 * E * sin(M) -
      0.01183 * E * sin(Mp + M) +
      0.00862 * sin(2 * Mp) +
      0.00804 * sin(2 * F) +
      0.00454 * E * sin(Mp - M) +
      0.00204 * E * E * sin(2 * M) -
      0.0018 * sin(Mp - 2 * F) -
      0.0007 * sin(Mp + 2 * F) -
      0.0004 * sin(3 * Mp) -
      0.00034 * E * sin(2 * Mp - M) +
      0.00032 * E * sin(M + 2 * F) +
      0.00032 * E * sin(M - 2 * F) -
      0.00028 * E * E * sin(Mp + 2 * M) +
      0.00027 * E * sin(2 * Mp + M) -
      0.00017 * sin(O);
    const W =
      0.00306 -
      0.00038 * E * cos(M) +
      0.00026 * cos(Mp) -
      0.00002 * cos(Mp - M) +
      0.00002 * cos(Mp + M) +
      0.00002 * cos(2 * F);
    jde += Math.abs(frac - 0.25) < 0.01 ? W : -W;
  }
  return jdeToDate(jde);
}

/** Approximate lunar-phase series index at a date. */
function approxK(date: Date): number {
  const yearFrac = date.getUTCFullYear() + date.getUTCMonth() / 12;
  return (yearFrac - 2000) * 12.3685;
}

/** Principal moon phases whose instant falls on a LOCAL day within
 * [startISO, endISO], keyed by local YYYY-MM-DD. */
export function moonPhasesByDate(startISO: string, endISO: string): Map<string, MoonPhaseMark> {
  const start = new Date(`${startISO}T00:00:00`);
  const end = new Date(`${endISO}T23:59:59`);
  const out = new Map<string, MoonPhaseMark>();
  const kBase = Math.floor(approxK(start)) - 2;
  const months = Math.ceil((end.getTime() - start.getTime()) / (SYNODIC_MONTH * 86_400_000)) + 4;
  for (let i = 0; i < months; i++) {
    for (const [offset, phase] of [
      [0, 'new'],
      [0.25, 'first-quarter'],
      [0.5, 'full'],
      [0.75, 'last-quarter'],
    ] as [number, PrincipalPhase][]) {
      const instant = phaseInstant(kBase + i + offset);
      if (instant < start || instant > end) continue;
      const meta = PHASE_META[phase];
      out.set(localISODate(instant), { phase, emoji: meta.emoji, label: meta.label, instant });
    }
  }
  return out;
}

export interface MoonInfo {
  ageDays: number;
  illumination: number; // 0..1
  name: string;
  emoji: string;
}

const INTERMEDIATE_NAMES: { limit: number; name: string; emoji: string }[] = [
  { limit: 1.85, name: 'New moon', emoji: '🌑' },
  { limit: 5.53, name: 'Waxing crescent', emoji: '🌒' },
  { limit: 9.22, name: 'First quarter', emoji: '🌓' },
  { limit: 12.91, name: 'Waxing gibbous', emoji: '🌔' },
  { limit: 16.61, name: 'Full moon', emoji: '🌕' },
  { limit: 20.3, name: 'Waning gibbous', emoji: '🌖' },
  { limit: 23.99, name: 'Last quarter', emoji: '🌗' },
  { limit: 27.68, name: 'Waning crescent', emoji: '🌘' },
  { limit: 30, name: 'New moon', emoji: '🌑' },
];

/** Moon age/illumination/name at local noon of a YYYY-MM-DD. */
export function moonInfoForDate(iso: string): MoonInfo {
  const at = new Date(`${iso}T12:00:00`);
  // Find the new moon at or before `at`.
  let k = Math.round(approxK(at));
  while (phaseInstant(k) > at) k--;
  while (phaseInstant(k + 1) <= at) k++;
  const ageDays = (at.getTime() - phaseInstant(k).getTime()) / 86_400_000;
  const illumination = (1 - Math.cos((2 * Math.PI * ageDays) / SYNODIC_MONTH)) / 2;
  const named = INTERMEDIATE_NAMES.find((n) => ageDays < n.limit) ?? INTERMEDIATE_NAMES[0];
  return { ageDays, illumination, name: named.name, emoji: named.emoji };
}

// ---------------------------------------------------------------------------
// Equinoxes & solstices (Meeus ch. 27)
// ---------------------------------------------------------------------------

export interface SeasonMark {
  name: string; // "March equinox", "June solstice", ...
  emoji: string;
  instant: Date;
}

const SEASON_TERMS: [number, number, number][] = [
  [485, 324.96, 1934.136],
  [203, 337.23, 32964.467],
  [199, 342.08, 20.186],
  [182, 27.85, 445267.112],
  [156, 73.14, 45036.886],
  [136, 171.52, 22518.443],
  [77, 222.54, 65928.934],
  [74, 296.72, 3034.906],
  [70, 243.58, 9037.513],
  [58, 119.81, 33718.147],
  [52, 297.17, 150.678],
  [50, 21.02, 2281.226],
  [45, 247.54, 29929.562],
  [44, 325.15, 31555.956],
  [29, 60.93, 4443.417],
  [18, 155.12, 67555.328],
  [17, 288.79, 4562.452],
  [16, 198.04, 62894.029],
  [14, 199.76, 31436.921],
  [12, 95.39, 14577.848],
  [12, 287.11, 31931.756],
  [12, 320.81, 34777.259],
  [9, 227.73, 1222.114],
  [8, 15.45, 16859.074],
];

function seasonInstant(year: number, index: 0 | 1 | 2 | 3): Date {
  const Y = (year - 2000) / 1000;
  const polys = [
    [2451623.80984, 365242.37404, 0.05169, -0.00411, -0.00057], // March
    [2451716.56767, 365241.62603, 0.00325, 0.00888, -0.0003], // June
    [2451810.21715, 365242.01767, -0.11575, 0.00337, 0.00078], // September
    [2451900.05952, 365242.74049, -0.06223, -0.00823, 0.00032], // December
  ][index];
  const jde0 = polys[0] + polys[1] * Y + polys[2] * Y * Y + polys[3] * Y ** 3 + polys[4] * Y ** 4;
  const T = (jde0 - 2451545) / 36525;
  const W = (35999.373 * T - 2.47) * DEG;
  const dLambda = 1 + 0.0334 * Math.cos(W) + 0.0007 * Math.cos(2 * W);
  const S = SEASON_TERMS.reduce((sum, [A, B, C]) => sum + A * Math.cos((B + C * T) * DEG), 0);
  return jdeToDate(jde0 + (0.00001 * S) / dLambda);
}

const SEASON_META = [
  { name: 'March equinox', emoji: '🌱' },
  { name: 'June solstice', emoji: '☀️' },
  { name: 'September equinox', emoji: '🍂' },
  { name: 'December solstice', emoji: '❄️' },
];

/** Equinox/solstice marks falling on local days within [startISO, endISO],
 * keyed by local YYYY-MM-DD. */
export function seasonMarksByDate(startISO: string, endISO: string): Map<string, SeasonMark> {
  const start = new Date(`${startISO}T00:00:00`);
  const end = new Date(`${endISO}T23:59:59`);
  const out = new Map<string, SeasonMark>();
  for (let year = start.getFullYear(); year <= end.getFullYear(); year++) {
    for (const index of [0, 1, 2, 3] as const) {
      const instant = seasonInstant(year, index);
      if (instant < start || instant > end) continue;
      const meta = SEASON_META[index];
      out.set(localISODate(instant), { name: meta.name, emoji: meta.emoji, instant });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Sunrise / sunset (Almanac for Computers)
// ---------------------------------------------------------------------------

export interface SunTimes {
  sunrise: Date;
  sunset: Date;
  daylightMinutes: number;
}

function sunEventUT(
  iso: string,
  latitude: number,
  longitude: number,
  rising: boolean
): number | null {
  const [y, m, d] = iso.split('-').map(Number);
  const n = Math.ceil(
    (Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 0)) / 86_400_000 // day of year
  );
  const lngHour = longitude / 15;
  const t = n + ((rising ? 6 : 18) - lngHour) / 24;
  const M = 0.9856 * t - 3.289;
  let L = M + 1.916 * Math.sin(M * DEG) + 0.02 * Math.sin(2 * M * DEG) + 282.634;
  L = ((L % 360) + 360) % 360;
  let RA = Math.atan(0.91764 * Math.tan(L * DEG)) / DEG;
  RA = ((RA % 360) + 360) % 360;
  RA += Math.floor(L / 90) * 90 - Math.floor(RA / 90) * 90; // same quadrant as L
  RA /= 15;
  const sinDec = 0.39782 * Math.sin(L * DEG);
  const cosDec = Math.cos(Math.asin(sinDec));
  const cosH =
    (Math.cos(90.833 * DEG) - sinDec * Math.sin(latitude * DEG)) /
    (cosDec * Math.cos(latitude * DEG));
  if (cosH > 1 || cosH < -1) return null; // polar day/night
  const H = (rising ? 360 - Math.acos(cosH) / DEG : Math.acos(cosH) / DEG) / 15;
  const T = H + RA - 0.06571 * t - 6.622;
  return (((T - lngHour) % 24) + 24) % 24; // hours UT
}

/** Sunrise/sunset for a local YYYY-MM-DD at a location; null at polar
 * latitudes when the sun never rises/sets that day. */
export function sunTimesForDate(iso: string, latitude: number, longitude: number): SunTimes | null {
  const riseUT = sunEventUT(iso, latitude, longitude, true);
  const setUT = sunEventUT(iso, latitude, longitude, false);
  if (riseUT === null || setUT === null) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const base = Date.UTC(y, m - 1, d);
  const sunrise = new Date(base + riseUT * 3_600_000);
  let sunset = new Date(base + setUT * 3_600_000);
  if (sunset < sunrise) sunset = new Date(sunset.getTime() + 86_400_000);
  return {
    sunrise,
    sunset,
    daylightMinutes: Math.round((sunset.getTime() - sunrise.getTime()) / 60_000),
  };
}

export function formatClock(d: Date): string {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export function formatDaylight(minutes: number): string {
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

// ---------------------------------------------------------------------------
// Astrology layer — still real orbital mechanics: tropical zodiac signs are
// 30° slices of ecliptic longitude (Meeus ch. 25 sun / ch. 47 moon,
// truncated), and Mercury retrograde is the apparent geocentric longitude
// reversal computed from JPL's approximate Keplerian elements (valid
// 1800-2050, ~arcminute accuracy — stations land within hours).
// ---------------------------------------------------------------------------

const ZODIAC = [
  { name: 'Aries', emoji: '♈' },
  { name: 'Taurus', emoji: '♉' },
  { name: 'Gemini', emoji: '♊' },
  { name: 'Cancer', emoji: '♋' },
  { name: 'Leo', emoji: '♌' },
  { name: 'Virgo', emoji: '♍' },
  { name: 'Libra', emoji: '♎' },
  { name: 'Scorpio', emoji: '♏' },
  { name: 'Sagittarius', emoji: '♐' },
  { name: 'Capricorn', emoji: '♑' },
  { name: 'Aquarius', emoji: '♒' },
  { name: 'Pisces', emoji: '♓' },
];

export interface ZodiacSign {
  name: string;
  emoji: string;
}

export function zodiacSign(eclipticLongitude: number): ZodiacSign {
  const lon = ((eclipticLongitude % 360) + 360) % 360;
  return ZODIAC[Math.floor(lon / 30) % 12];
}

function julianCenturies(date: Date): number {
  return (date.getTime() / 86_400_000 + JD_UNIX_EPOCH - 2451545) / 36525;
}

/** Apparent ecliptic longitude of the sun, degrees (Meeus ch. 25). */
export function sunLongitude(date: Date): number {
  const T = julianCenturies(date);
  const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
  const M = (357.52911 + 35999.05029 * T - 0.0001537 * T * T) * DEG;
  const C =
    (1.914602 - 0.004817 * T) * Math.sin(M) +
    (0.019993 - 0.000101 * T) * Math.sin(2 * M) +
    0.000289 * Math.sin(3 * M);
  const omega = (125.04 - 1934.136 * T) * DEG;
  // True longitude corrected for nutation + aberration → apparent.
  const lambda = L0 + C - 0.00569 - 0.00478 * Math.sin(omega);
  return ((lambda % 360) + 360) % 360;
}

/** Geocentric ecliptic longitude of the moon, degrees (Meeus ch. 47,
 * main periodic terms — ~0.05° accuracy; the moon moves ~13°/day). */
export function moonLongitude(date: Date): number {
  const T = julianCenturies(date);
  const Lp = 218.3164477 + 481267.88123421 * T - 0.0015786 * T * T;
  const D = (297.8501921 + 445267.1114034 * T - 0.0018819 * T * T) * DEG;
  const M = (357.5291092 + 35999.0502909 * T - 0.0001536 * T * T) * DEG;
  const Mp = (134.9633964 + 477198.8675055 * T + 0.0087414 * T * T) * DEG;
  const F = (93.272095 + 483202.0175233 * T - 0.0036539 * T * T) * DEG;
  const { sin } = Math;
  const lambda =
    Lp +
    6.288774 * sin(Mp) +
    1.274027 * sin(2 * D - Mp) +
    0.658314 * sin(2 * D) +
    0.213618 * sin(2 * Mp) -
    0.185116 * sin(M) -
    0.114332 * sin(2 * F) +
    0.058793 * sin(2 * D - 2 * Mp) +
    0.057066 * sin(2 * D - M - Mp) +
    0.053322 * sin(2 * D + Mp) +
    0.045758 * sin(2 * D - M) -
    0.040923 * sin(M - Mp) -
    0.03472 * sin(D) -
    0.030383 * sin(M + Mp) +
    0.015327 * sin(2 * D - 2 * F) -
    0.012528 * sin(Mp + 2 * F) +
    0.01098 * sin(Mp - 2 * F);
  return ((lambda % 360) + 360) % 360;
}

// JPL approximate Keplerian elements (J2000 values + per-century rates).
// [a AU, e, I°, L°, ϖ°, Ω°] — element and rate rows per body.
const MERCURY_EL = [0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593];
const MERCURY_RATE = [
  0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081,
];
const EARTH_EL = [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0];
const EARTH_RATE = [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0];

function heliocentricXY(el: number[], rate: number[], T: number): { x: number; y: number } {
  const [a, e, I, L, w_, O] = el.map((v, i) => v + rate[i] * T);
  const omega = (w_ - O) * DEG;
  const Om = O * DEG;
  const inc = I * DEG;
  let M = (((L - w_) % 360) + 360) % 360;
  M *= DEG;
  let E = M + e * Math.sin(M);
  for (let i = 0; i < 6; i++) E = E + (M - (E - e * Math.sin(E))) / (1 - e * Math.cos(E));
  const xp = a * (Math.cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const { sin, cos } = Math;
  return {
    x:
      (cos(omega) * cos(Om) - sin(omega) * sin(Om) * cos(inc)) * xp +
      (-sin(omega) * cos(Om) - cos(omega) * sin(Om) * cos(inc)) * yp,
    y:
      (cos(omega) * sin(Om) + sin(omega) * cos(Om) * cos(inc)) * xp +
      (-sin(omega) * sin(Om) + cos(omega) * cos(Om) * cos(inc)) * yp,
  };
}

/** Geocentric apparent ecliptic longitude of Mercury, degrees. */
export function mercuryLongitude(date: Date): number {
  const T = julianCenturies(date);
  const m = heliocentricXY(MERCURY_EL, MERCURY_RATE, T);
  const e = heliocentricXY(EARTH_EL, EARTH_RATE, T);
  const lambda = Math.atan2(m.y - e.y, m.x - e.x) / DEG;
  return ((lambda % 360) + 360) % 360;
}

/** Is Mercury apparently retrograde (geocentric longitude decreasing) at
 * local noon of a YYYY-MM-DD? Central difference over ±12h. */
export function isMercuryRetrograde(iso: string): boolean {
  const noon = new Date(`${iso}T12:00:00`).getTime();
  const before = mercuryLongitude(new Date(noon - 43_200_000));
  const after = mercuryLongitude(new Date(noon + 43_200_000));
  let delta = after - before;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return delta < 0;
}

export interface AstrologyInfo {
  sunSign: ZodiacSign;
  moonSign: ZodiacSign;
  mercuryRetrograde: boolean;
}

/** Tropical sun/moon signs + Mercury retrograde status at local noon. */
export function astrologyForDate(iso: string): AstrologyInfo {
  const at = new Date(`${iso}T12:00:00`);
  return {
    sunSign: zodiacSign(sunLongitude(at)),
    moonSign: zodiacSign(moonLongitude(at)),
    mercuryRetrograde: isMercuryRetrograde(iso),
  };
}

export interface StationMark {
  label: string;
  direction: 'retrograde' | 'direct';
}

/** Days within [startISO, endISO] where Mercury's apparent motion flips —
 * the astrological "stations". Keyed by local YYYY-MM-DD. */
export function mercuryStationsByDate(startISO: string, endISO: string): Map<string, StationMark> {
  const out = new Map<string, StationMark>();
  const start = new Date(`${startISO}T12:00:00`);
  const end = new Date(`${endISO}T12:00:00`);
  let prev: boolean | null = null;
  for (let t = start.getTime() - 86_400_000; t <= end.getTime(); t += 86_400_000) {
    const d = new Date(t);
    const iso = localISODate(d);
    const retro = isMercuryRetrograde(iso);
    if (prev !== null && retro !== prev && t >= start.getTime()) {
      out.set(iso, {
        direction: retro ? 'retrograde' : 'direct',
        label: retro ? 'Mercury stations retrograde' : 'Mercury stations direct',
      });
    }
    prev = retro;
  }
  return out;
}
