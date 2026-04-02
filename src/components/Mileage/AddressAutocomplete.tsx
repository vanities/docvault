import { useState, useRef, useEffect, useCallback } from 'react';
import { MapPin, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface GeocodeSuggestion {
  formatted: string;
  lat: number;
  lon: number;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state?: string;
}

export interface SelectedAddress {
  formatted: string;
  lat: number;
  lon: number;
}

interface AddressAutocompleteProps {
  label: string;
  placeholder?: string;
  value: SelectedAddress | null;
  onChange: (address: SelectedAddress | null) => void;
}

export function AddressAutocomplete({
  label,
  placeholder = 'Start typing an address...',
  value,
  onChange,
}: AddressAutocompleteProps) {
  const [inputValue, setInputValue] = useState('');
  const [suggestions, setSuggestions] = useState<GeocodeSuggestion[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Sync input text when value is set externally (e.g., quick-fill buttons)
  useEffect(() => {
    if (value && inputValue !== value.formatted) {
      setInputValue(value.formatted);
    } else if (!value && inputValue && !isOpen) {
      setInputValue('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const fetchSuggestions = useCallback(async (text: string) => {
    if (text.length < 3) {
      setSuggestions([]);
      setIsOpen(false);
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch(`/api/geocode/autocomplete?text=${encodeURIComponent(text)}`);
      const data = await res.json();
      const results: GeocodeSuggestion[] = data.results || [];
      setSuggestions(results);
      setIsOpen(results.length > 0);
    } catch (err) {
      console.error('Autocomplete fetch error:', err);
      setSuggestions([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleInputChange = (text: string) => {
    setInputValue(text);

    // Clear selection if user is typing over a selected address
    if (value) {
      onChange(null);
    }

    // Debounce the API call
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      void fetchSuggestions(text);
    }, 300);
  };

  const handleSelect = (suggestion: GeocodeSuggestion) => {
    onChange({
      formatted: suggestion.formatted,
      lat: suggestion.lat,
      lon: suggestion.lon,
    });
    setInputValue(suggestion.formatted);
    setIsOpen(false);
    setSuggestions([]);
  };

  const handleClear = () => {
    setInputValue('');
    onChange(null);
    setSuggestions([]);
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
      <label className="text-[11px] text-surface-600 uppercase tracking-wider block mb-1">
        {label}
      </label>
      <div className="relative">
        <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-surface-500" />
        <Input
          type="text"
          value={inputValue}
          onChange={(e) => handleInputChange(e.target.value)}
          onFocus={() => {
            if (suggestions.length > 0 && !value) {
              setIsOpen(true);
            }
          }}
          placeholder={placeholder}
          className={`pl-8 pr-8 ${
            value
              ? 'border-teal-400/50 focus-visible:ring-teal-400/30 focus-visible:border-teal-400'
              : ''
          }`}
        />
        {isLoading && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-surface-500 animate-spin" />
        )}
        {!isLoading && (inputValue || value) && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={handleClear}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-surface-500 hover:text-surface-700 size-6"
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>

      {/* Dropdown */}
      {isOpen && suggestions.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-surface-100 border border-border rounded-lg shadow-lg overflow-hidden backdrop-blur-sm">
          {suggestions.map((suggestion, idx) => (
            <Button
              key={`${suggestion.lat}-${suggestion.lon}-${idx}`}
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => handleSelect(suggestion)}
              className="w-full justify-start rounded-none text-surface-900 hover:bg-teal-500/10 border-b border-border/30 last:border-b-0 h-auto py-2.5 px-3"
            >
              <MapPin className="w-3.5 h-3.5 text-teal-500 flex-shrink-0" />
              <span className="truncate">{suggestion.formatted}</span>
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
