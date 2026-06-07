// Weather location for the Newsstand forecast (Open-Meteo — no API key). Type a
// city, look it up via keyless geocoding, and it's stored as lat/lon. A week-ahead
// forecast box then renders in each edition.

import { useEffect, useState } from 'react';
import { CloudSun, Loader2, MapPin, Save, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { useToast } from '../../hooks/useToast';
import { API_BASE } from '../../constants';

interface GeoResult {
  label: string;
  latitude: number;
  longitude: number;
}

export function WeatherSettingsSection() {
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [label, setLabel] = useState('');
  const [lat, setLat] = useState<number | null>(null);
  const [lon, setLon] = useState<number | null>(null);
  const [units, setUnits] = useState<'F' | 'C'>('F');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeoResult[]>([]);
  const [searching, setSearching] = useState(false);

  const load = async () => {
    try {
      const res = await fetch(`${API_BASE}/settings`);
      const d = await res.json();
      const w = d.weather ?? {};
      setEnabled(w.enabled ?? false);
      setLabel(w.label ?? '');
      setLat(typeof w.latitude === 'number' ? w.latitude : null);
      setLon(typeof w.longitude === 'number' ? w.longitude : null);
      setUnits(w.units === 'C' ? 'C' : 'F');
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const search = async () => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(`${API_BASE}/weather/geocode?q=${encodeURIComponent(query.trim())}`);
      const d = (await res.json()) as { results?: GeoResult[] };
      setResults(d.results ?? []);
      if (!(d.results ?? []).length) addToast('No matches — try "City, State"', 'info');
    } catch {
      addToast('Lookup failed', 'error');
    } finally {
      setSearching(false);
    }
  };

  const pick = (r: GeoResult) => {
    setLabel(r.label);
    setLat(r.latitude);
    setLon(r.longitude);
    setResults([]);
    setQuery('');
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          weather: {
            enabled,
            label,
            latitude: lat ?? undefined,
            longitude: lon ?? undefined,
            units,
          },
        }),
      });
      if ((await res.json()).ok) {
        addToast('Weather settings saved', 'success');
        await load();
      } else {
        addToast('Failed to save', 'error');
      }
    } catch {
      addToast('Failed to save', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card variant="glass" className="p-6 mb-8">
        <div className="text-center py-4 text-surface-600">Loading…</div>
      </Card>
    );
  }

  return (
    <Card variant="glass" className="p-6 mb-8">
      <h3 className="text-lg font-semibold text-surface-950 flex items-center gap-2 mb-1">
        <CloudSun className="w-5 h-5" />
        Weather (Newsstand)
      </h3>
      <p className="text-[12px] text-surface-600 mb-4">
        Adds a week-ahead forecast box to each Newsstand edition. Powered by{' '}
        <span className="font-medium">Open-Meteo</span> — no API key needed.
      </p>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[13px] font-medium text-surface-900">Show weather in editions</p>
            <p className="text-[11px] text-surface-500">Needs a location set below.</p>
          </div>
          <button
            onClick={() => setEnabled(!enabled)}
            className={`relative w-10 h-5 rounded-full transition-colors ${enabled ? 'bg-violet-500' : 'bg-surface-400'}`}
          >
            <span
              className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform"
              style={{ left: enabled ? 22 : 2 }}
            />
          </button>
        </div>

        <div>
          <label className="block text-[12px] text-surface-600 mb-1">Location</label>
          <div className="flex gap-2">
            <Input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void search();
              }}
              placeholder="Search a city, e.g. Spring Hill, TN"
              className="text-[13px]"
            />
            <Button variant="ghost" size="sm" onClick={() => void search()} disabled={searching}>
              {searching ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Search className="w-4 h-4" />
              )}
            </Button>
          </div>
          {results.length > 0 && (
            <div className="mt-1 border border-border/40 rounded-lg divide-y divide-border/30 overflow-hidden">
              {results.map((r, i) => (
                <button
                  key={i}
                  onClick={() => pick(r)}
                  className="w-full text-left px-3 py-1.5 text-[13px] hover:bg-surface-200/40"
                >
                  {r.label}{' '}
                  <span className="text-[11px] text-surface-500">
                    ({r.latitude.toFixed(2)}, {r.longitude.toFixed(2)})
                  </span>
                </button>
              ))}
            </div>
          )}
          {lat != null && lon != null && (
            <p className="text-[12px] text-surface-700 mt-1.5 flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5 text-surface-500" />
              {label || 'Selected'}
              <span className="text-surface-500">
                · {lat.toFixed(3)}, {lon.toFixed(3)}
              </span>
            </p>
          )}
        </div>

        <div>
          <label className="block text-[12px] text-surface-600 mb-1">Units</label>
          <select
            value={units}
            onChange={(e) => setUnits(e.target.value as 'F' | 'C')}
            className="text-[13px] bg-surface-100/60 border border-border/40 rounded-lg px-2 py-1.5"
          >
            <option value="F">Fahrenheit (°F)</option>
            <option value="C">Celsius (°C)</option>
          </select>
        </div>

        <Button onClick={save} size="sm" disabled={saving}>
          <Save className="w-4 h-4" />
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </Card>
  );
}
