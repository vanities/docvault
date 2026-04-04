import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  MapPin,
  Plus,
  Trash2,
  TrendingUp,
  TrendingDown,
  ChevronDown,
  ChevronUp,
  Edit3,
  RefreshCw,
} from 'lucide-react';
import type { PropertyEntry, PropertyData, PropertyType, PropertyAddress } from '../../types';
import { useAppContext } from '../../contexts/AppContext';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const API = '/api/property';

const PROPERTY_TYPES: { id: PropertyType; label: string }[] = [
  { id: 'primary-residence', label: 'Primary Residence' },
  { id: 'rental', label: 'Rental Property' },
  { id: 'investment-land', label: 'Investment Land' },
  { id: 'vacation', label: 'Vacation Home' },
  { id: 'commercial', label: 'Commercial' },
  { id: 'other', label: 'Other' },
];

const US_STATES = [
  'AL',
  'AK',
  'AZ',
  'AR',
  'CA',
  'CO',
  'CT',
  'DE',
  'FL',
  'GA',
  'HI',
  'ID',
  'IL',
  'IN',
  'IA',
  'KS',
  'KY',
  'LA',
  'ME',
  'MD',
  'MA',
  'MI',
  'MN',
  'MS',
  'MO',
  'MT',
  'NE',
  'NV',
  'NH',
  'NJ',
  'NM',
  'NY',
  'NC',
  'ND',
  'OH',
  'OK',
  'OR',
  'PA',
  'RI',
  'SC',
  'SD',
  'TN',
  'TX',
  'UT',
  'VT',
  'VA',
  'WA',
  'WV',
  'WI',
  'WY',
];

function formatUsd(value: number): string {
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

// Strip commas, $, spaces — parse to number
function parseCurrency(val: string): number {
  return Number(val.replace(/[,$\s]/g, '')) || 0;
}

// Currency input that accepts commas, decimals, and formats on blur
function CurrencyInput({
  value,
  onChange,
  placeholder,
  required,
  className,
}: {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  required?: boolean;
  className?: string;
}) {
  const [display, setDisplay] = useState(value);

  // Sync external changes (e.g., populateForm)
  useEffect(() => {
    setDisplay(value);
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    // Allow digits, commas, periods, and empty
    if (/^[0-9,.\s]*$/.test(raw) || raw === '') {
      setDisplay(raw);
      onChange(raw);
    }
  };

  const handleBlur = () => {
    const num = parseCurrency(display);
    if (num > 0) {
      const formatted = num.toLocaleString('en-US', {
        maximumFractionDigits: 2,
      });
      setDisplay(formatted);
      onChange(formatted);
    }
  };

  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-surface-500 z-10">
        $
      </span>
      <Input
        type="text"
        inputMode="decimal"
        value={display}
        onChange={handleChange}
        onBlur={handleBlur}
        placeholder={placeholder}
        required={required}
        className={className || 'pl-7 h-9 rounded-lg text-sm'}
      />
    </div>
  );
}

function formatPropertyType(type: PropertyType): string {
  return PROPERTY_TYPES.find((t) => t.id === type)?.label || type;
}

function formatAddress(addr: PropertyAddress): string {
  return `${addr.street}, ${addr.city}, ${addr.state} ${addr.zip}`;
}

function getPropertyColor(type: PropertyType): string {
  switch (type) {
    case 'primary-residence':
      return 'text-emerald-500';
    case 'rental':
      return 'text-blue-500';
    case 'investment-land':
      return 'text-amber-500';
    case 'vacation':
      return 'text-violet-500';
    case 'commercial':
      return 'text-rose-500';
    default:
      return 'text-surface-600';
  }
}

function getPropertyBgColor(type: PropertyType): string {
  switch (type) {
    case 'primary-residence':
      return 'bg-emerald-500/10';
    case 'rental':
      return 'bg-blue-500/10';
    case 'investment-land':
      return 'bg-amber-500/10';
    case 'vacation':
      return 'bg-violet-500/10';
    case 'commercial':
      return 'bg-rose-500/10';
    default:
      return 'bg-surface-200/50';
  }
}

// =============================================================================
// Component
// =============================================================================

export function PropertyView() {
  const { hideQuickStats } = useAppContext();
  const [data, setData] = useState<PropertyData>({ entries: [] });
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [propertyType, setPropertyType] = useState<PropertyType>('primary-residence');
  const [street, setStreet] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('TN');
  const [zip, setZip] = useState('');
  const [acreage, setAcreage] = useState('');
  const [squareFeet, setSquareFeet] = useState('');
  const [purchaseDate, setPurchaseDate] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [currentValue, setCurrentValue] = useState('');
  const [annualPropertyTax, setAnnualPropertyTax] = useState('');
  const [mortgageLender, setMortgageLender] = useState('');
  const [mortgageBalance, setMortgageBalance] = useState('');
  const [mortgageRate, setMortgageRate] = useState('');
  const [mortgagePayment, setMortgagePayment] = useState('');
  const [notes, setNotes] = useState('');

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(API);
      const json = await res.json();
      setData({ entries: json.entries || [] });
    } catch (err) {
      console.error('Failed to load property data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const resetForm = () => {
    setName('');
    setPropertyType('primary-residence');
    setStreet('');
    setCity('');
    setState('TN');
    setZip('');
    setAcreage('');
    setSquareFeet('');
    setPurchaseDate('');
    setPurchasePrice('');
    setCurrentValue('');
    setAnnualPropertyTax('');
    setMortgageLender('');
    setMortgageBalance('');
    setMortgageRate('');
    setMortgagePayment('');
    setNotes('');
    setEditingId(null);
  };

  const populateForm = (entry: PropertyEntry) => {
    setName(entry.name);
    setPropertyType(entry.type as PropertyType);
    setStreet(entry.address.street);
    setCity(entry.address.city);
    setState(entry.address.state);
    setZip(entry.address.zip);
    setAcreage(entry.acreage?.toString() || '');
    setSquareFeet(entry.squareFeet?.toString() || '');
    setPurchaseDate(entry.purchaseDate);
    setPurchasePrice(entry.purchasePrice.toLocaleString('en-US'));
    setCurrentValue(entry.currentValue.toLocaleString('en-US'));
    setAnnualPropertyTax(entry.annualPropertyTax?.toLocaleString('en-US') || '');
    setMortgageLender(entry.mortgage?.lender || '');
    setMortgageBalance(entry.mortgage?.balance?.toLocaleString('en-US') || '');
    setMortgageRate(entry.mortgage?.rate ? (entry.mortgage.rate * 100).toString() : '');
    setMortgagePayment(entry.mortgage?.monthlyPayment?.toLocaleString('en-US') || '');
    setNotes(entry.notes || '');
    setEditingId(entry.id);
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !street.trim() || !purchasePrice || !currentValue) return;

    setSubmitting(true);
    const body = {
      name: name.trim(),
      type: propertyType,
      address: { street: street.trim(), city: city.trim(), state, zip: zip.trim() },
      acreage: acreage ? Number(acreage) : undefined,
      squareFeet: squareFeet ? Number(squareFeet) : undefined,
      purchaseDate: purchaseDate || new Date().toISOString().split('T')[0],
      purchasePrice: parseCurrency(purchasePrice),
      currentValue: parseCurrency(currentValue),
      annualPropertyTax: annualPropertyTax ? parseCurrency(annualPropertyTax) : undefined,
      mortgage: mortgageLender
        ? {
            lender: mortgageLender.trim(),
            balance: parseCurrency(mortgageBalance),
            rate: Number(mortgageRate || 0) / 100,
            monthlyPayment: parseCurrency(mortgagePayment),
          }
        : undefined,
      notes: notes.trim() || undefined,
    };

    try {
      const url = editingId ? `${API}/${editingId}` : API;
      const method = editingId ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        const json = await res.json();
        if (editingId) {
          setData((prev) => ({
            entries: prev.entries.map((e) => (e.id === editingId ? json.entry : e)),
          }));
        } else {
          setData((prev) => ({ entries: [...prev.entries, json.entry] }));
        }
        resetForm();
        setShowForm(false);
      }
    } catch (err) {
      console.error('Failed to save property:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`${API}/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setData((prev) => ({ entries: prev.entries.filter((e) => e.id !== id) }));
      }
    } catch (err) {
      console.error('Failed to delete property:', err);
    }
  };

  // Compute summary
  const summary = useMemo(() => {
    let totalCurrentValue = 0;
    let totalPurchaseValue = 0;
    let totalEquity = 0;
    let totalMortgage = 0;
    let totalPropertyTax = 0;

    for (const entry of data.entries) {
      totalCurrentValue += entry.currentValue;
      totalPurchaseValue += entry.purchasePrice;
      totalMortgage += entry.mortgage?.balance || 0;
      totalEquity += entry.currentValue - (entry.mortgage?.balance || 0);
      totalPropertyTax += entry.annualPropertyTax || 0;
    }

    return { totalCurrentValue, totalPurchaseValue, totalEquity, totalMortgage, totalPropertyTax };
  }, [data.entries]);

  const appreciation = summary.totalCurrentValue - summary.totalPurchaseValue;
  const appreciationPct =
    summary.totalPurchaseValue > 0
      ? ((appreciation / summary.totalPurchaseValue) * 100).toFixed(1)
      : '0.0';
  const isGain = appreciation >= 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-6 h-6 text-surface-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-emerald-500/10 rounded-xl">
            <MapPin className="w-6 h-6 text-emerald-500" />
          </div>
          <div>
            <h1 className="font-display text-xl text-surface-950">Property &amp; Land</h1>
            <p className="text-sm text-surface-600 hidden sm:block">
              Track real estate holdings and equity
            </p>
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={() => {
            resetForm();
            setShowForm(!showForm);
          }}
          className="bg-emerald-600 hover:bg-emerald-500"
        >
          <Plus className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Add Property</span>
        </Button>
      </div>

      {/* Summary Cards */}
      {data.entries.length > 0 && !hideQuickStats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card variant="glass" className="p-4">
            <span className="text-xs text-surface-600">Total Value</span>
            <p className="text-lg font-semibold text-surface-950">
              {formatUsd(summary.totalCurrentValue)}
            </p>
          </Card>
          <Card variant="glass" className="p-4">
            <span className="text-xs text-surface-600">Total Equity</span>
            <p className="text-lg font-semibold text-surface-950">
              {formatUsd(summary.totalEquity)}
            </p>
          </Card>
          <Card variant="glass" className="p-4">
            <span className="text-xs text-surface-600">Appreciation</span>
            <p
              className={`text-lg font-semibold flex items-center gap-1 ${isGain ? 'text-accent-500' : 'text-danger-500'}`}
            >
              {isGain ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
              {formatUsd(Math.abs(appreciation))}
              <span className="text-xs font-normal">({appreciationPct}%)</span>
            </p>
          </Card>
          <Card variant="glass" className="p-4">
            <span className="text-xs text-surface-600">Mortgage Balance</span>
            <p className="text-lg font-semibold text-surface-950">
              {formatUsd(summary.totalMortgage)}
            </p>
          </Card>
        </div>
      )}

      {/* Add/Edit Form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="glass-card rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-semibold text-surface-950">
            {editingId ? 'Edit Property' : 'Add New Property'}
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Name */}
            <div>
              <label className="block text-xs font-medium text-surface-600 mb-1">
                Property Name
              </label>
              <Input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Springfield House"
                required
                className="h-9 rounded-lg text-sm"
              />
            </div>

            {/* Type */}
            <div>
              <label className="block text-xs font-medium text-surface-600 mb-1">Type</label>
              <Select
                value={propertyType}
                onValueChange={(val) => setPropertyType(val as PropertyType)}
              >
                <SelectTrigger className="w-full text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROPERTY_TYPES.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Address */}
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-surface-600 mb-1">
                Street Address
              </label>
              <Input
                type="text"
                value={street}
                onChange={(e) => setStreet(e.target.value)}
                placeholder="123 Main St"
                required
                className="h-9 rounded-lg text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-surface-600 mb-1">City</label>
              <Input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="Springfield"
                required
                className="h-9 rounded-lg text-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-surface-600 mb-1">State</label>
                <Select value={state} onValueChange={setState}>
                  <SelectTrigger className="w-full text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {US_STATES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="block text-xs font-medium text-surface-600 mb-1">ZIP</label>
                <Input
                  type="text"
                  value={zip}
                  onChange={(e) => setZip(e.target.value)}
                  placeholder="37174"
                  className="h-9 rounded-lg text-sm"
                />
              </div>
            </div>

            {/* Size */}
            <div>
              <label className="block text-xs font-medium text-surface-600 mb-1">
                Acreage <span className="text-surface-500">(optional)</span>
              </label>
              <Input
                type="number"
                value={acreage}
                onChange={(e) => setAcreage(e.target.value)}
                placeholder="0.5"
                step="0.01"
                min="0"
                className="h-9 rounded-lg text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-surface-600 mb-1">
                Square Feet <span className="text-surface-500">(optional)</span>
              </label>
              <Input
                type="number"
                value={squareFeet}
                onChange={(e) => setSquareFeet(e.target.value)}
                placeholder="2400"
                min="0"
                className="h-9 rounded-lg text-sm"
              />
            </div>

            {/* Financial */}
            <div>
              <label className="block text-xs font-medium text-surface-600 mb-1">
                Purchase Date
              </label>
              <Input
                type="date"
                value={purchaseDate}
                onChange={(e) => setPurchaseDate(e.target.value)}
                className="h-9 rounded-lg text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-surface-600 mb-1">
                Purchase Price
              </label>
              <CurrencyInput
                value={purchasePrice}
                onChange={setPurchasePrice}
                placeholder="350,000"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-surface-600 mb-1">
                Current Estimated Value
              </label>
              <CurrencyInput
                value={currentValue}
                onChange={setCurrentValue}
                placeholder="425,000"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-surface-600 mb-1">
                Annual Property Tax <span className="text-surface-500">(optional)</span>
              </label>
              <CurrencyInput
                value={annualPropertyTax}
                onChange={setAnnualPropertyTax}
                placeholder="3,200"
              />
            </div>
          </div>

          {/* Mortgage Section */}
          <div>
            <h4 className="text-xs font-semibold text-surface-600 uppercase tracking-wider mb-3">
              Mortgage <span className="normal-case font-normal">(leave blank if paid off)</span>
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-surface-600 mb-1">Lender</label>
                <Input
                  type="text"
                  value={mortgageLender}
                  onChange={(e) => setMortgageLender(e.target.value)}
                  placeholder="e.g., Rocket Mortgage"
                  className="h-9 rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-surface-600 mb-1">
                  Remaining Balance
                </label>
                <CurrencyInput
                  value={mortgageBalance}
                  onChange={setMortgageBalance}
                  placeholder="280,000"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-surface-600 mb-1">
                  Interest Rate (%)
                </label>
                <Input
                  type="text"
                  inputMode="decimal"
                  value={mortgageRate}
                  onChange={(e) => {
                    if (/^[0-9.]*$/.test(e.target.value) || e.target.value === '') {
                      setMortgageRate(e.target.value);
                    }
                  }}
                  placeholder="6.5"
                  className="h-9 rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-surface-600 mb-1">
                  Monthly Payment
                </label>
                <CurrencyInput
                  value={mortgagePayment}
                  onChange={setMortgagePayment}
                  placeholder="2,100"
                />
              </div>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-medium text-surface-600 mb-1">
              Notes <span className="text-surface-500">(optional)</span>
            </label>
            <Input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Parcel number, HOA, etc."
              className="h-9 rounded-lg text-sm"
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowForm(false);
                resetForm();
              }}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={submitting || !name.trim() || !purchasePrice || !currentValue}
              className="bg-emerald-600 hover:bg-emerald-500"
            >
              {submitting ? 'Saving...' : editingId ? 'Update Property' : 'Add Property'}
            </Button>
          </div>
        </form>
      )}

      {/* Entries List */}
      {data.entries.length === 0 ? (
        <Card variant="glass" className="p-10 text-center">
          <MapPin className="w-10 h-10 text-emerald-500/40 mx-auto mb-3" />
          <p className="text-surface-600 text-sm">No properties tracked yet.</p>
          <p className="text-surface-500 text-xs mt-1">
            Click "Add Property" to start tracking your real estate.
          </p>
        </Card>
      ) : (
        <PropertyList entries={data.entries} onDelete={handleDelete} onEdit={populateForm} />
      )}
    </div>
  );
}

// =============================================================================
// Property List Sub-component
// =============================================================================

function PropertyList({
  entries,
  onDelete,
  onEdit,
}: {
  entries: PropertyEntry[];
  onDelete: (id: string) => void;
  onEdit: (entry: PropertyEntry) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const sorted = useMemo(
    () => [...entries].sort((a, b) => b.currentValue - a.currentValue),
    [entries]
  );

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold text-surface-600 uppercase tracking-wider px-1">
        Properties ({entries.length})
      </h3>
      {sorted.map((entry) => {
        const equity = entry.currentValue - (entry.mortgage?.balance || 0);
        const appreciation = entry.currentValue - entry.purchasePrice;
        const appPct =
          entry.purchasePrice > 0 ? ((appreciation / entry.purchasePrice) * 100).toFixed(1) : '0.0';
        const isExpanded = expanded === entry.id;
        const pType = entry.type as PropertyType;

        return (
          <Card variant="glass" key={entry.id} className="overflow-hidden">
            <button
              onClick={() => setExpanded(isExpanded ? null : entry.id)}
              className="w-full flex items-center justify-between p-4 text-left hover:bg-surface-100/50 transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className={`p-2 rounded-lg ${getPropertyBgColor(pType)}`}>
                  <MapPin className={`w-4 h-4 ${getPropertyColor(pType)}`} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-surface-950 truncate">{entry.name}</p>
                  <p className="text-xs text-surface-500 truncate">
                    {formatPropertyType(pType)} · {formatAddress(entry.address)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <p className="text-sm font-semibold text-surface-950">
                    {formatUsd(entry.currentValue)}
                  </p>
                  <p
                    className={`text-xs ${appreciation >= 0 ? 'text-accent-500' : 'text-danger-500'}`}
                  >
                    {appreciation >= 0 ? '+' : ''}
                    {appPct}%
                  </p>
                </div>
                {isExpanded ? (
                  <ChevronUp className="w-4 h-4 text-surface-400" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-surface-400" />
                )}
              </div>
            </button>

            {isExpanded && (
              <div className="px-4 pb-4 border-t border-border pt-3">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                  <div>
                    <span className="text-surface-500">Purchase Price</span>
                    <p className="font-medium text-surface-900">{formatUsd(entry.purchasePrice)}</p>
                  </div>
                  <div>
                    <span className="text-surface-500">Current Value</span>
                    <p className="font-medium text-surface-900">{formatUsd(entry.currentValue)}</p>
                    {entry.currentValueDate && (
                      <p className="text-[10px] text-surface-400">
                        Updated {entry.currentValueDate}
                      </p>
                    )}
                  </div>
                  <div>
                    <span className="text-surface-500">Equity</span>
                    <p className="font-medium text-surface-900">{formatUsd(equity)}</p>
                  </div>
                  <div>
                    <span className="text-surface-500">Appreciation</span>
                    <p
                      className={`font-medium ${appreciation >= 0 ? 'text-accent-500' : 'text-danger-500'}`}
                    >
                      {appreciation >= 0 ? '+' : ''}
                      {formatUsd(appreciation)}
                    </p>
                  </div>
                  {entry.purchaseDate && (
                    <div>
                      <span className="text-surface-500">Purchase Date</span>
                      <p className="font-medium text-surface-900">{entry.purchaseDate}</p>
                    </div>
                  )}
                  {entry.acreage && (
                    <div>
                      <span className="text-surface-500">Acreage</span>
                      <p className="font-medium text-surface-900">{entry.acreage} acres</p>
                    </div>
                  )}
                  {entry.squareFeet && (
                    <div>
                      <span className="text-surface-500">Square Feet</span>
                      <p className="font-medium text-surface-900">
                        {entry.squareFeet.toLocaleString()} sqft
                      </p>
                    </div>
                  )}
                  {entry.annualPropertyTax && (
                    <div>
                      <span className="text-surface-500">Annual Tax</span>
                      <p className="font-medium text-surface-900">
                        {formatUsd(entry.annualPropertyTax)}
                      </p>
                    </div>
                  )}
                </div>

                {/* Mortgage details */}
                {entry.mortgage && (
                  <div className="mt-3 p-3 bg-surface-100/50 rounded-lg">
                    <h4 className="text-xs font-semibold text-surface-600 mb-2">Mortgage</h4>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                      <div>
                        <span className="text-surface-500">Lender</span>
                        <p className="font-medium text-surface-900">{entry.mortgage.lender}</p>
                      </div>
                      <div>
                        <span className="text-surface-500">Balance</span>
                        <p className="font-medium text-surface-900">
                          {formatUsd(entry.mortgage.balance)}
                        </p>
                      </div>
                      <div>
                        <span className="text-surface-500">Rate</span>
                        <p className="font-medium text-surface-900">
                          {(entry.mortgage.rate * 100).toFixed(2)}%
                        </p>
                      </div>
                      <div>
                        <span className="text-surface-500">Monthly Payment</span>
                        <p className="font-medium text-surface-900">
                          {formatUsd(entry.mortgage.monthlyPayment)}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {entry.notes && (
                  <p className="text-xs text-surface-500 mt-2 italic">{entry.notes}</p>
                )}

                <div className="mt-3 flex justify-end gap-2">
                  <Button type="button" variant="ghost" size="xs" onClick={() => onEdit(entry)}>
                    <Edit3 className="w-3.5 h-3.5" />
                    Edit
                  </Button>
                  <Button
                    type="button"
                    variant="ghost-danger"
                    size="xs"
                    onClick={() => onDelete(entry.id)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete
                  </Button>
                </div>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
