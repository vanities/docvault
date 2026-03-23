import { Calendar, ChevronDown } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';

interface TaxYearSelectorProps {
  selectedYear: number;
  availableYears: number[];
  onYearChange: (year: number) => void;
  disabled?: boolean;
}

export function TaxYearSelector({
  selectedYear,
  availableYears,
  onYearChange,
  disabled = false,
}: TaxYearSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className="flex items-center gap-2 px-3 py-1.5 bg-surface-200/50 border border-border rounded-lg hover:bg-surface-300/50 transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Calendar className="w-3.5 h-3.5 text-surface-600" />
        <span className="font-medium text-[13px] text-surface-900">{selectedYear}</span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-surface-600 transition-transform duration-150 ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen && (
        <div className="absolute top-full right-0 mt-1.5 glass-strong rounded-xl shadow-2xl z-40 min-w-[140px] py-1 animate-scale-in">
          {availableYears.map((year) => (
            <button
              key={year}
              onClick={() => {
                onYearChange(year);
                setIsOpen(false);
              }}
              className={`
                w-full px-3.5 py-2 text-left text-[13px] transition-all duration-100
                ${year === selectedYear ? 'bg-accent-500/10 text-accent-400 font-medium' : 'text-surface-800 hover:bg-surface-300/30 hover:text-surface-950'}
              `}
            >
              {year}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
