// Calendar layer toggles — which computed layers (moon phases, astrology,
// meteors, sun times, holidays, DST, weather) show on the calendar grid and
// day panel. The Daily News "Week Ahead" box honors the same toggles, so a
// layer turned off here disappears from the paper too. Location for sun
// times and the forecast comes from the Weather section above — the app's
// single location source of truth.

import { useEffect, useState } from 'react';
import { CalendarDays, Loader2, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useToast } from '../../hooks/useToast';
import { API_BASE } from '../../constants';
import { requestJson } from '../../api/client';

interface CalendarToggles {
  showMoon?: boolean;
  showSeasons?: boolean;
  showAstrology?: boolean;
  showMeteors?: boolean;
  showSunTimes?: boolean;
  showHolidays?: boolean;
  showDst?: boolean;
  showWeather?: boolean;
}

const TOGGLE_META: { key: keyof CalendarToggles; label: string; hint: string }[] = [
  { key: 'showMoon', label: 'Moon phases', hint: 'new/quarter/full glyphs, supermoons, eclipses' },
  { key: 'showSeasons', label: 'Seasons', hint: 'equinoxes and solstices' },
  { key: 'showAstrology', label: 'Astrology', hint: 'zodiac signs, Mercury retrograde' },
  { key: 'showMeteors', label: 'Meteor showers', hint: 'annual peak nights' },
  { key: 'showSunTimes', label: 'Sunrise & sunset', hint: 'day panel, uses the weather location' },
  { key: 'showHolidays', label: 'US holidays', hint: 'federal holidays on the grid' },
  { key: 'showDst', label: 'Clock changes', hint: 'daylight-saving transitions' },
  { key: 'showWeather', label: 'Forecast on grid', hint: 'next 7 days, from the weather location' },
];

export function CalendarSettingsSection() {
  const { addToast } = useToast();
  const [toggles, setToggles] = useState<CalendarToggles>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    requestJson<{ calendar?: CalendarToggles }>(`${API_BASE}/settings`)
      .then((s) => setToggles(s.calendar ?? {}))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await requestJson(`${API_BASE}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ calendar: toggles }),
      });
      addToast('Calendar layers saved', 'success');
    } catch {
      addToast('Failed to save calendar settings', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 mb-1">
        <CalendarDays className="w-4 h-4 text-orange-400" />
        <h3 className="text-[14px] font-semibold text-surface-950">Calendar Layers</h3>
      </div>
      <p className="text-[12px] text-surface-600 mb-4 leading-relaxed">
        Computed layers shown on the calendar. The Daily News “Week Ahead” box follows the same
        switches — turn a layer off and it leaves the paper too. Sun times and the forecast use the
        Weather location above.
      </p>
      {loading ? (
        <Loader2 className="w-4 h-4 animate-spin text-surface-600" />
      ) : (
        <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2 mb-4">
          {TOGGLE_META.map(({ key, label, hint }) => (
            <label key={key} className="flex items-start gap-2 text-[13px] text-surface-900">
              <input
                type="checkbox"
                checked={toggles[key] !== false}
                onChange={(e) => setToggles((t) => ({ ...t, [key]: e.target.checked }))}
                className="accent-emerald-500 mt-0.5"
              />
              <span>
                {label}
                <span className="block text-[11px] text-surface-600">{hint}</span>
              </span>
            </label>
          ))}
        </div>
      )}
      <Button size="sm" onClick={() => void save()} disabled={saving || loading}>
        {saving ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Save className="w-3.5 h-3.5" />
        )}
        Save
      </Button>
    </Card>
  );
}
