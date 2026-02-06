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
        className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Calendar className="w-4 h-4 text-gray-500" />
        <span className="font-medium">Tax Year {selectedYear}</span>
        <ChevronDown
          className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-10 min-w-[160px]">
          {availableYears.map((year) => (
            <button
              key={year}
              onClick={() => {
                onYearChange(year);
                setIsOpen(false);
              }}
              className={`
                w-full px-4 py-2 text-left hover:bg-gray-50 first:rounded-t-lg last:rounded-b-lg
                ${year === selectedYear ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700'}
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
