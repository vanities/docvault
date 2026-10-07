// Weather forecast for the Daily News — Open-Meteo (https://open-meteo.com).
// FREE, no API key, no signup: it blends national weather models (NOAA GFS/HRRR,
// ECMWF, DWD ICON, …) so the data is real, not a toy. We fetch a 7-day daily
// forecast for the configured location and cache it on disk (~30 min) so
// repeated edition generations (and the theme sampler) don't re-hit the API.

import { promises as fs } from 'fs';
import path from 'path';
import { DATA_DIR } from './data.js';
import { createLogger } from './logger.js';

const log = createLogger('Weather');
const CACHE_FILE = path.join(DATA_DIR, '.docvault-weather-cache.json');
const CACHE_TTL_MS = 30 * 60 * 1000;
const ENDPOINT = 'https://api.open-meteo.com/v1/forecast';

export interface WeatherDay {
  /** YYYY-MM-DD (location-local). */
  date: string;
  hi: number;
  lo: number;
  /** WMO weather code. */
  code: number;
  /** Short condition label, e.g. "Partly cloudy". */
  label: string;
  emoji: string;
  /** Max precipitation probability for the day, %. */
  precipPct: number;
}

export interface WeatherForecast {
  /** Human label for the location, e.g. "Spring Hill, TN". */
  label: string;
  units: 'F' | 'C';
  days: WeatherDay[];
  fetchedAt: string;
}

export interface WeatherFetchOptions {
  latitude: number;
  longitude: number;
  label: string;
  units: 'F' | 'C';
}

// WMO weather interpretation codes → short label + emoji.
// https://open-meteo.com/en/docs (WMO Weather interpretation codes)
function describe(code: number): { label: string; emoji: string } {
  if (code === 0) return { label: 'Clear', emoji: '☀️' };
  if (code <= 2) return { label: 'Partly cloudy', emoji: '⛅' };
  if (code === 3) return { label: 'Overcast', emoji: '☁️' };
  if (code <= 48) return { label: 'Fog', emoji: '🌫️' };
  if (code <= 57) return { label: 'Drizzle', emoji: '🌦️' };
  if (code <= 67) return { label: 'Rain', emoji: '🌧️' };
  if (code <= 77) return { label: 'Snow', emoji: '🌨️' };
  if (code <= 82) return { label: 'Showers', emoji: '🌦️' };
  if (code <= 86) return { label: 'Snow showers', emoji: '🌨️' };
  return { label: 'Thunderstorm', emoji: '⛈️' };
}

function cacheKey(o: WeatherFetchOptions): string {
  return `${o.latitude.toFixed(3)},${o.longitude.toFixed(3)},${o.units}`;
}

async function readCache(key: string): Promise<WeatherForecast | null> {
  try {
    const cached = JSON.parse(await fs.readFile(CACHE_FILE, 'utf-8')) as WeatherForecast & {
      _key?: string;
    };
    if (cached._key === key && Date.now() - new Date(cached.fetchedAt).getTime() < CACHE_TTL_MS) {
      return cached;
    }
  } catch {
    /* no/with stale cache */
  }
  return null;
}

/**
 * 7-day daily forecast for the location, cache-first. Best-effort: returns null
 * on any failure (so a dead weather API never sinks an edition).
 */
export async function fetchWeekForecast(o: WeatherFetchOptions): Promise<WeatherForecast | null> {
  const key = cacheKey(o);
  const cached = await readCache(key);
  if (cached) {
    log.debug(`[weather] cache hit for ${o.label}`);
    return cached;
  }

  const t0 = Date.now();
  const tempUnit = o.units === 'C' ? 'celsius' : 'fahrenheit';
  const url =
    `${ENDPOINT}?latitude=${o.latitude}&longitude=${o.longitude}` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
    `&temperature_unit=${tempUnit}&timezone=auto&forecast_days=7`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      log.warn(`[weather] HTTP ${res.status} for ${o.label}`);
      return null;
    }
    const data = (await res.json()) as {
      daily?: {
        time?: string[];
        weather_code?: number[];
        temperature_2m_max?: number[];
        temperature_2m_min?: number[];
        precipitation_probability_max?: Array<number | null>;
      };
    };
    const d = data.daily;
    if (!d?.time?.length) {
      log.warn(`[weather] no daily data for ${o.label}`);
      return null;
    }
    const days: WeatherDay[] = d.time.map((date, i) => {
      const code = d.weather_code?.[i] ?? 0;
      const { label, emoji } = describe(code);
      return {
        date,
        hi: Math.round(d.temperature_2m_max?.[i] ?? 0),
        lo: Math.round(d.temperature_2m_min?.[i] ?? 0),
        code,
        label,
        emoji,
        precipPct: Math.round(d.precipitation_probability_max?.[i] ?? 0),
      };
    });
    const forecast: WeatherForecast = {
      label: o.label,
      units: o.units,
      days,
      fetchedAt: new Date().toISOString(),
    };
    await fs
      .writeFile(CACHE_FILE, JSON.stringify({ ...forecast, _key: key }, null, 2))
      .catch(() => undefined);
    log.info(
      `[weather] fetched ${days.length}-day forecast for ${o.label} in ${Date.now() - t0}ms`
    );
    return forecast;
  } catch (err) {
    log.warn(`[weather] fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

export interface GeocodeResult {
  label: string;
  latitude: number;
  longitude: number;
  /** IANA timezone for the place (Open-Meteo returns it), e.g. 'America/Chicago'. */
  timezone?: string;
}

/** Look up a place name → coordinates via Open-Meteo's keyless geocoding API.
 *  Used by the Settings UI so the user types "Spring Hill, TN" instead of lat/lon. */
export async function geocodePlace(query: string): Promise<GeocodeResult[]> {
  const q = query.trim();
  if (!q) return [];
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=en&format=json`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      log.warn(`[geocode] HTTP ${res.status} for "${q}"`);
      return [];
    }
    const data = (await res.json()) as {
      results?: Array<{
        name?: string;
        admin1?: string;
        country_code?: string;
        latitude?: number;
        longitude?: number;
        timezone?: string;
      }>;
    };
    return (data.results ?? [])
      .filter((r) => typeof r.latitude === 'number' && typeof r.longitude === 'number')
      .map((r) => ({
        label: [r.name, r.admin1, r.country_code].filter(Boolean).join(', '),
        latitude: r.latitude as number,
        longitude: r.longitude as number,
        timezone: typeof r.timezone === 'string' ? r.timezone : undefined,
      }));
  } catch (err) {
    log.warn(`[geocode] failed: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

/** Compact one-line-per-day strings for the edition prompt (prose). */
export function forecastToLines(f: WeatherForecast): string[] {
  return f.days.map((d) => {
    const day = new Date(`${d.date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short' });
    const rain = d.precipPct >= 20 ? `, ${d.precipPct}% precip` : '';
    return `${day} ${d.date}: ${d.hi}°/${d.lo}°${f.units}, ${d.label.toLowerCase()}${rain}`;
  });
}
