import { useState, type ReactNode } from 'react';
import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { SETTINGS_SECTIONS } from './settingsSections';

function SettingsNavigation({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [query, setQuery] = useState('');
  const sections = SETTINGS_SECTIONS.filter((section) =>
    `${section.label} ${section.description} ${section.keywords}`
      .toLowerCase()
      .includes(query.trim().toLowerCase())
  );
  return (
    <nav aria-label="Settings sections" className="min-w-0 lg:sticky lg:top-6 lg:self-start">
      <div className="relative mb-3">
        <Search className="absolute left-3 top-3.5 size-4 text-surface-800" aria-hidden="true" />
        <Input
          aria-label="Find a setting"
          placeholder="Find a setting…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="h-11 text-base sm:text-sm placeholder:text-surface-800 pl-9 pr-10"
        />
        {query && (
          <button
            type="button"
            aria-label="Clear settings search"
            onClick={() => setQuery('')}
            className="absolute right-0 top-0 flex size-11 items-center justify-center text-surface-800"
          >
            <X className="size-4" />
          </button>
        )}
      </div>
      <label className="lg:hidden">
        <span className="sr-only">Settings section</span>
        <select
          aria-label="Settings section"
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
            setQuery('');
          }}
          className="h-11 w-full rounded-lg border border-border bg-surface-50 px-3 text-sm text-surface-900"
        >
          {SETTINGS_SECTIONS.map((section) => (
            <option key={section.id} value={section.id}>
              {section.label}
            </option>
          ))}
        </select>
      </label>
      <div
        className={`${query ? 'grid' : 'hidden'} mt-3 gap-1 lg:mt-0 lg:grid lg:max-h-[75vh] lg:overflow-y-auto`}
      >
        {sections.map(({ id, label, description, icon: Icon }) => (
          <button
            key={id}
            type="button"
            aria-current={value === id ? 'page' : undefined}
            onClick={() => {
              onChange(id);
              setQuery('');
            }}
            className={`flex min-h-12 w-full items-start gap-3 rounded-lg p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${value === id ? 'bg-accent-500/10 text-accent-400' : 'text-surface-800 hover:bg-surface-200/50'}`}
          >
            <Icon className="mt-0.5 size-4 shrink-0" />
            <span className="min-w-0">
              <span className="block text-sm font-medium">{label}</span>
              <span className="mt-0.5 block text-xs text-surface-800">{description}</span>
            </span>
          </button>
        ))}
        {sections.length === 0 && (
          <p role="status" className="px-3 py-4 text-sm text-surface-800">
            No settings found. Try “backup”, “models” or “email”.
          </p>
        )}
      </div>
    </nav>
  );
}

export function SettingsLayout({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
      <SettingsNavigation value={value} onChange={onChange} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
