import { getWeatherConfig } from '../../data.js';
import { fetchWeekForecast, forecastToLines } from '../../weather.js';
import { ReadCollector } from '../request.js';
import type { ContextSource } from '../types.js';

export const weatherSource: ContextSource = {
  id: 'weather',
  label: 'Weather',
  group: 'outlook',
  description:
    'The 7-day forecast for the configured location: highs, lows, conditions and chance of rain.',
  files: ['.docvault-weather-cache.json'],
  async read() {
    const r = new ReadCollector();
    await r.part('weather', async () => {
      const cfg = await getWeatherConfig();
      if (!cfg.enabled || cfg.latitude == null || cfg.longitude == null) return;
      const forecast = await fetchWeekForecast({
        latitude: cfg.latitude,
        longitude: cfg.longitude,
        label: cfg.label,
        units: cfg.units,
      });
      if (!forecast) return;
      r.lines.push(`Weather for ${forecast.label}:`, ...forecastToLines(forecast));
    });
    return r.result();
  },
};
