// Google-Calendar-style time picker: a scrollable dropdown of 15-minute
// slots (Radix Select — auto-scrolls to the selection, supports keyboard
// type-ahead, renders a native-feeling sheet on mobile). Off-grid values
// (legacy entries logged at odd minutes) are injected as an extra option so
// editing them never silently snaps the time.

import { useMemo } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatClock } from './types';

const SLOTS: string[] = [];
for (let h = 0; h < 24; h++) {
  for (let m = 0; m < 60; m += 15) {
    SLOTS.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  }
}

export function TimeSlotPicker({
  value,
  onChange,
  ariaLabel,
  hour24 = true,
}: {
  value: string;
  onChange: (time: string) => void;
  ariaLabel: string;
  hour24?: boolean;
}) {
  const options = useMemo(() => {
    if (!value || SLOTS.includes(value)) return SLOTS;
    // Keep the odd-minute value selectable, in chronological position.
    const merged = [...SLOTS, value].sort();
    return merged;
  }, [value]);

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-9 w-full rounded-lg text-sm" aria-label={ariaLabel}>
        <SelectValue placeholder="Time" />
      </SelectTrigger>
      <SelectContent className="max-h-64">
        {options.map((t) => (
          <SelectItem key={t} value={t}>
            {formatClock(t, hour24)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
