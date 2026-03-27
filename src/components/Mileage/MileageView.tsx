import { useState, useEffect, useCallback } from 'react';
import {
  Fuel,
  Plus,
  Trash2,
  ChevronDown,
  ChevronUp,
  Car,
  MapPin,
  Loader2,
  Home,
  Pencil,
  Check,
  X,
  Settings2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import type { Vehicle, MileageEntry, MileageData, SavedAddress } from '../../types';
import { useAppContext } from '../../contexts/AppContext';
import { useToast } from '../../hooks/useToast';
import { AddressAutocomplete } from './AddressAutocomplete';
import type { SelectedAddress } from './AddressAutocomplete';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const API = '/api/mileage';

export function MileageView() {
  const { selectedEntity, entities } = useAppContext();
  const { addToast } = useToast();
  const [data, setData] = useState<MileageData>({ vehicles: [], entries: [], irsRate: 0.7 });
  const [loading, setLoading] = useState(true);

  // Form state
  const [vehicleId, setVehicleId] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [odometerStart, setOdometerStart] = useState('');
  const [odometerEnd, setOdometerEnd] = useState('');
  const [tripMiles, setTripMiles] = useState('');
  const [gallons, setGallons] = useState('');
  const [totalCost, setTotalCost] = useState('');
  const [purpose, setPurpose] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  // Address autocomplete
  const [geocodeEnabled, setGeocodeEnabled] = useState(false);
  const [fromAddress, setFromAddress] = useState<SelectedAddress | null>(null);
  const [toAddress, setToAddress] = useState<SelectedAddress | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeMiles, setRouteMiles] = useState<number | null>(null);

  // Saved address form
  const [showAddressForm, setShowAddressForm] = useState(false);
  const [newAddrLabel, setNewAddrLabel] = useState('');
  const [newAddrSelected, setNewAddrSelected] = useState<SelectedAddress | null>(null);

  // Vehicle form
  const [showVehicleForm, setShowVehicleForm] = useState(false);
  const [newVehicleName, setNewVehicleName] = useState('');
  const [newVehicleYear, setNewVehicleYear] = useState('');
  const [newVehicleMake, setNewVehicleMake] = useState('');
  const [newVehicleModel, setNewVehicleModel] = useState('');
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);

  // Edit state — entries
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editVehicleId, setEditVehicleId] = useState('');
  const [editTripMiles, setEditTripMiles] = useState('');
  const [editGallons, setEditGallons] = useState('');
  const [editTotalCost, setEditTotalCost] = useState('');
  const [editPurpose, setEditPurpose] = useState('');
  const [editOdometerStart, setEditOdometerStart] = useState('');
  const [editOdometerEnd, setEditOdometerEnd] = useState('');

  // Edit state — vehicles
  const [editingVehicleId, setEditingVehicleId] = useState<string | null>(null);
  const [editVehicleName, setEditVehicleName] = useState('');
  const [editVehicleYear, setEditVehicleYear] = useState('');
  const [editVehicleMake, setEditVehicleMake] = useState('');
  const [editVehicleModel, setEditVehicleModel] = useState('');

  // Edit state — addresses
  const [editingAddrId, setEditingAddrId] = useState<string | null>(null);
  const [editAddrLabel, setEditAddrLabel] = useState('');

  // Settings modal
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'vehicles' | 'addresses'>('vehicles');

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(API);
      const json = await res.json();
      setData(json);
      if (!vehicleId && json.vehicles.length > 0) {
        setVehicleId(json.vehicles[0].id);
      }
    } catch (err) {
      console.error('Failed to load mileage:', err);
    } finally {
      setLoading(false);
    }
  }, [vehicleId]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (odometerStart && odometerEnd) {
      const start = parseFloat(odometerStart);
      const end = parseFloat(odometerEnd);
      if (!isNaN(start) && !isNaN(end) && end > start) setTripMiles(String(end - start));
    }
  }, [odometerStart, odometerEnd]);

  useEffect(() => {
    const checkGeocode = async () => {
      try {
        const res = await fetch('/api/geocode/enabled');
        const d = await res.json();
        setGeocodeEnabled(d.enabled === true);
      } catch {
        setGeocodeEnabled(false);
      }
    };
    void checkGeocode();
  }, []);

  const savedAddresses: SavedAddress[] = data.savedAddresses || [];

  useEffect(() => {
    if (!fromAddress || !toAddress) {
      setRouteMiles(null);
      return;
    }
    const fetchRoute = async () => {
      setRouteLoading(true);
      try {
        const params = new URLSearchParams({
          from_lat: String(fromAddress.lat),
          from_lon: String(fromAddress.lon),
          to_lat: String(toAddress.lat),
          to_lon: String(toAddress.lon),
        });
        const res = await fetch(`/api/geocode/route?${params}`);
        const d = await res.json();
        if (d.miles != null) {
          setRouteMiles(d.miles);
          setTripMiles(String(d.miles));
        }
      } catch (err) {
        console.error('Route calculation error:', err);
      } finally {
        setRouteLoading(false);
      }
    };
    void fetchRoute();
  }, [fromAddress, toAddress]);

  // ── CRUD handlers ─────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vehicleId) return;
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = { vehicleId, date };
      if (odometerStart) body.odometerStart = parseFloat(odometerStart);
      if (odometerEnd) body.odometerEnd = parseFloat(odometerEnd);
      if (tripMiles) body.tripMiles = parseFloat(tripMiles);
      if (gallons) body.gallons = parseFloat(gallons);
      if (totalCost) body.totalCost = parseFloat(totalCost);
      if (purpose.trim()) body.purpose = purpose.trim();
      if (selectedEntity !== 'all') body.entity = selectedEntity;
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setOdometerStart('');
        setOdometerEnd('');
        setTripMiles('');
        setGallons('');
        setTotalCost('');
        setPurpose('');
        setFromAddress(null);
        setToAddress(null);
        setRouteMiles(null);
        setDate(new Date().toISOString().split('T')[0]);
        await fetchData();
        addToast('Trip recorded', 'success');
      } else {
        addToast('Failed to record trip', 'error');
      }
    } catch {
      addToast('Failed to record trip', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    await fetch(`${API}/${id}`, { method: 'DELETE' });
    await fetchData();
  };

  const startEditEntry = (entry: MileageEntry) => {
    setEditingEntryId(entry.id);
    setEditDate(entry.date);
    setEditVehicleId(entry.vehicleId);
    setEditTripMiles(entry.tripMiles != null ? String(entry.tripMiles) : '');
    setEditGallons(entry.gallons != null ? String(entry.gallons) : '');
    setEditTotalCost(entry.totalCost != null ? String(entry.totalCost) : '');
    setEditPurpose(entry.purpose || '');
    setEditOdometerStart(entry.odometerStart != null ? String(entry.odometerStart) : '');
    setEditOdometerEnd(entry.odometerEnd != null ? String(entry.odometerEnd) : '');
  };

  const handleUpdateEntry = async (id: string) => {
    await fetch(`${API}/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: editDate,
        vehicleId: editVehicleId,
        tripMiles: editTripMiles || '',
        gallons: editGallons || '',
        totalCost: editTotalCost || '',
        purpose: editPurpose,
        odometerStart: editOdometerStart || '',
        odometerEnd: editOdometerEnd || '',
      }),
    });
    setEditingEntryId(null);
    await fetchData();
  };

  // Vehicle CRUD
  const handleAddVehicle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newVehicleName.trim()) return;
    const body: Record<string, unknown> = { name: newVehicleName.trim() };
    if (newVehicleYear) body.year = parseInt(newVehicleYear);
    if (newVehicleMake.trim()) body.make = newVehicleMake.trim();
    if (newVehicleModel.trim()) body.model = newVehicleModel.trim();
    await fetch(`${API}/vehicles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setNewVehicleName('');
    setNewVehicleYear('');
    setNewVehicleMake('');
    setNewVehicleModel('');
    setShowVehicleForm(false);
    await fetchData();
  };

  const handleDeleteVehicle = async (id: string) => {
    await fetch(`${API}/vehicles/${id}`, { method: 'DELETE' });
    await fetchData();
  };

  const startEditVehicle = (v: Vehicle) => {
    setEditingVehicleId(v.id);
    setEditVehicleName(v.name);
    setEditVehicleYear(v.year != null ? String(v.year) : '');
    setEditVehicleMake(v.make || '');
    setEditVehicleModel(v.model || '');
  };

  const handleUpdateVehicle = async (id: string) => {
    await fetch(`${API}/vehicles/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: editVehicleName.trim(),
        year: editVehicleYear || '',
        make: editVehicleMake.trim(),
        model: editVehicleModel.trim(),
      }),
    });
    setEditingVehicleId(null);
    await fetchData();
  };

  // Address CRUD
  const handleAddAddress = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAddrLabel.trim() || !newAddrSelected) return;
    await fetch(`${API}/addresses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label: newAddrLabel.trim(),
        formatted: newAddrSelected.formatted,
        lat: newAddrSelected.lat,
        lon: newAddrSelected.lon,
      }),
    });
    setNewAddrLabel('');
    setNewAddrSelected(null);
    setShowAddressForm(false);
    await fetchData();
  };

  const handleDeleteAddress = async (id: string) => {
    await fetch(`${API}/addresses/${id}`, { method: 'DELETE' });
    await fetchData();
  };

  const startEditAddress = (a: SavedAddress) => {
    setEditingAddrId(a.id);
    setEditAddrLabel(a.label);
  };

  const handleUpdateAddress = async (id: string) => {
    await fetch(`${API}/addresses/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: editAddrLabel.trim() }),
    });
    setEditingAddrId(null);
    await fetchData();
  };

  // ── Derived data ──────────────────────────────────────────────────
  const filteredEntries =
    selectedEntity === 'all'
      ? data.entries
      : data.entries.filter((e) => e.entity === selectedEntity);
  const entityName = entities.find((e) => e.id === selectedEntity)?.name;

  const entriesByMonth = filteredEntries
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date))
    .reduce<Record<string, MileageEntry[]>>((acc, entry) => {
      const m = entry.date.substring(0, 7);
      if (!acc[m]) acc[m] = [];
      acc[m].push(entry);
      return acc;
    }, {});
  const months = Object.keys(entriesByMonth).sort((a, b) => b.localeCompare(a));
  const currentMonth = new Date().toISOString().substring(0, 7);
  const activeMonth = expandedMonth ?? currentMonth;
  const currentMonthEntries = entriesByMonth[currentMonth] || [];
  const currentMonthMiles = currentMonthEntries.reduce((sum, e) => sum + (e.tripMiles || 0), 0);
  const irsDeduction = currentMonthMiles * data.irsRate;
  const allTimeMiles = filteredEntries.reduce((sum, e) => sum + (e.tripMiles || 0), 0);
  const allTimeDeduction = allTimeMiles * data.irsRate;
  const fillUps = filteredEntries.filter(
    (e) => e.gallons && e.gallons > 0 && e.tripMiles && e.tripMiles > 0
  );
  const avgMpg =
    fillUps.length > 0
      ? fillUps.reduce((sum, e) => sum + e.tripMiles! / e.gallons!, 0) / fillUps.length
      : 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-6 h-6 border-2 border-teal-400 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-6 space-y-5 overflow-x-hidden">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2.5 bg-teal-500/10 rounded-xl">
          <Fuel className="w-6 h-6 text-teal-500" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl text-surface-950 italic">Mileage Tracker</h1>
          <p className="text-[12px] text-surface-600 truncate">
            {entityName || (selectedEntity === 'all' ? 'All Entities' : selectedEntity)} · IRS Rate:
            ${data.irsRate.toFixed(2)}/mile
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="shrink-0 text-surface-500 hover:text-surface-900"
          onClick={() => setSettingsOpen(true)}
        >
          <Settings2 className="w-5 h-5" />
        </Button>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-3 gap-2">
        <Card variant="glass" className="p-3">
          <p className="text-[10px] text-surface-500 uppercase tracking-wider font-medium">
            This Month
          </p>
          <p className="text-lg font-bold text-surface-950 tabular-nums mt-0.5">
            {currentMonthMiles.toFixed(0)}
          </p>
          <p className="text-[10px] text-surface-500">miles</p>
        </Card>
        <Card variant="glass" className="p-3">
          <p className="text-[10px] text-surface-500 uppercase tracking-wider font-medium">
            IRS Deduct
          </p>
          <p className="text-lg font-bold text-teal-500 tabular-nums mt-0.5">
            ${irsDeduction.toFixed(0)}
          </p>
          <p className="text-[10px] text-surface-500">this month</p>
        </Card>
        <Card variant="glass" className="p-3">
          <p className="text-[10px] text-surface-500 uppercase tracking-wider font-medium">
            Avg MPG
          </p>
          <p className="text-lg font-bold text-surface-950 tabular-nums mt-0.5">
            {avgMpg > 0 ? avgMpg.toFixed(1) : '—'}
          </p>
          <p className="text-[10px] text-surface-500">
            {fillUps.length} fill-up{fillUps.length !== 1 ? 's' : ''}
          </p>
        </Card>
      </div>

      {/* All-time bar */}
      <Card variant="glass" className="px-4 py-2.5 flex items-center justify-center gap-4">
        <span className="text-[11px] text-surface-500 uppercase tracking-wider font-medium">
          All Time
        </span>
        <span className="text-sm font-semibold text-surface-900 tabular-nums">
          {allTimeMiles.toFixed(0)} mi
        </span>
        <span className="text-sm font-bold text-teal-500 tabular-nums">
          ${allTimeDeduction.toFixed(2)}
        </span>
      </Card>

      {/* New Entry Form */}
      <form onSubmit={handleSubmit} className="glass-card rounded-xl p-4 space-y-3">
        <h2 className="text-sm font-semibold text-surface-900">New Entry</h2>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="mb-1">Date</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <Label className="mb-1">Vehicle</Label>
            <Select
              value={vehicleId || undefined}
              onValueChange={setVehicleId}
              disabled={data.vehicles.length === 0}
            >
              <SelectTrigger className="w-full">
                <SelectValue
                  placeholder={
                    data.vehicles.length === 0 ? 'Add a vehicle first' : 'Select vehicle'
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {data.vehicles.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.name}
                    {v.year ? ` (${v.year})` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {geocodeEnabled && (
          <div className="space-y-2">
            <div>
              <AddressAutocomplete
                label="From"
                placeholder="Start address..."
                value={fromAddress}
                onChange={setFromAddress}
              />
              {savedAddresses.length > 0 && !fromAddress && (
                <div className="flex gap-1.5 mt-1.5 flex-wrap">
                  {savedAddresses.map((addr) => (
                    <button
                      key={addr.id}
                      type="button"
                      onClick={() =>
                        setFromAddress({ formatted: addr.formatted, lat: addr.lat, lon: addr.lon })
                      }
                      className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-surface-600 hover:text-teal-500 bg-surface-100 border border-border rounded-lg hover:border-teal-400/30 transition-colors"
                      title={addr.formatted}
                    >
                      <Home className="w-3 h-3" />
                      {addr.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div>
              <AddressAutocomplete
                label="To"
                placeholder="Destination address..."
                value={toAddress}
                onChange={setToAddress}
              />
              {savedAddresses.length > 0 && !toAddress && (
                <div className="flex gap-1.5 mt-1.5 flex-wrap">
                  {savedAddresses.map((addr) => (
                    <button
                      key={addr.id}
                      type="button"
                      onClick={() =>
                        setToAddress({ formatted: addr.formatted, lat: addr.lat, lon: addr.lon })
                      }
                      className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-surface-600 hover:text-teal-500 bg-surface-100 border border-border rounded-lg hover:border-teal-400/30 transition-colors"
                      title={addr.formatted}
                    >
                      <Home className="w-3 h-3" />
                      {addr.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {routeLoading && (
              <div className="flex items-center gap-2 text-[12px] text-surface-500">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Calculating distance...
              </div>
            )}
            {routeMiles != null && !routeLoading && (
              <div className="flex items-center gap-2 text-[12px] text-teal-500 font-medium">
                <MapPin className="w-3.5 h-3.5" /> Driving distance: {routeMiles} miles
              </div>
            )}
          </div>
        )}

        <div>
          <Label className="mb-1">
            Trip Miles
            {geocodeEnabled && (
              <span className="text-surface-400 font-normal normal-case ml-1">
                {routeMiles != null ? '(auto, editable)' : 'or enter manually'}
              </span>
            )}
          </Label>
          <Input
            type="number"
            step="0.1"
            min="0"
            value={tripMiles}
            onChange={(e) => setTripMiles(e.target.value)}
            placeholder="24.5"
          />
        </div>

        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="text-teal-500 hover:text-teal-400"
          onClick={() => setShowDetails(!showDetails)}
        >
          {showDetails ? (
            <ChevronUp className="w-3.5 h-3.5" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5" />
          )}
          {showDetails ? 'Hide Details' : 'Gas & Odometer Details'}
        </Button>

        {showDetails && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="mb-1">Odo Start</Label>
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  value={odometerStart}
                  onChange={(e) => setOdometerStart(e.target.value)}
                  placeholder="45,230"
                />
              </div>
              <div>
                <Label className="mb-1">Odo End</Label>
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  value={odometerEnd}
                  onChange={(e) => setOdometerEnd(e.target.value)}
                  placeholder="45,255"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="mb-1">Gallons</Label>
                <Input
                  type="number"
                  step="0.001"
                  min="0"
                  value={gallons}
                  onChange={(e) => setGallons(e.target.value)}
                  placeholder="12.5"
                />
              </div>
              <div>
                <Label className="mb-1">Total Cost</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={totalCost}
                  onChange={(e) => setTotalCost(e.target.value)}
                  placeholder="42.50"
                />
              </div>
            </div>
            <div>
              <Label className="mb-1">Purpose</Label>
              <Input
                type="text"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                placeholder="e.g. Client meeting, Office commute"
              />
            </div>
          </div>
        )}

        <Button
          type="submit"
          size="lg"
          className="w-full bg-teal-500 hover:bg-teal-400"
          disabled={submitting || !vehicleId || !tripMiles}
        >
          <MapPin className="w-4 h-4" /> Record Trip
          {tripMiles ? ` — ${parseFloat(tripMiles).toFixed(1)} mi` : ''}
        </Button>
      </form>

      {/* Trip History */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-surface-900">Trip History</h2>

        {months.length === 0 && (
          <Card variant="glass" className="py-10 text-center">
            <Car className="w-8 h-8 text-surface-300 mx-auto mb-2" />
            <p className="text-sm text-surface-500">No trips recorded yet</p>
          </Card>
        )}

        {months.map((month) => {
          const entries = entriesByMonth[month];
          const monthMiles = entries.reduce((sum, e) => sum + (e.tripMiles || 0), 0);
          const monthDeduction = monthMiles * data.irsRate;
          const isExpanded = activeMonth === month;
          const monthLabel = new Date(month + '-01T00:00:00').toLocaleDateString('en-US', {
            month: 'long',
            year: 'numeric',
          });

          return (
            <Card variant="glass" key={month} className="overflow-hidden">
              <button
                type="button"
                onClick={() => setExpandedMonth(isExpanded ? null : month)}
                className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-surface-100/50 transition-colors"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm font-medium text-surface-900 truncate">
                    {monthLabel}
                  </span>
                  <span className="text-[11px] text-surface-500 shrink-0">({entries.length})</span>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-2">
                  <span className="text-sm font-bold text-teal-500 tabular-nums">
                    {monthMiles.toFixed(0)} mi
                  </span>
                  {isExpanded ? (
                    <ChevronUp className="w-4 h-4 text-surface-400" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-surface-400" />
                  )}
                </div>
              </button>

              {isExpanded && (
                <div className="border-t border-border">
                  <div className="px-4 py-2 bg-teal-500/5 flex items-center justify-between">
                    <span className="text-[11px] text-teal-600 font-medium uppercase tracking-wider">
                      Month Deduction
                    </span>
                    <span className="text-sm font-bold text-teal-500 tabular-nums">
                      ${monthDeduction.toFixed(2)}
                    </span>
                  </div>

                  {entries.map((entry) => {
                    const vehicle = data.vehicles.find((v) => v.id === entry.vehicleId);
                    const mpg =
                      entry.gallons && entry.gallons > 0 && entry.tripMiles
                        ? (entry.tripMiles / entry.gallons).toFixed(1)
                        : null;
                    const isEditing = editingEntryId === entry.id;

                    if (isEditing) {
                      return (
                        <div
                          key={entry.id}
                          className="px-4 py-3 space-y-2 bg-surface-50 border-b border-border/50 last:border-b-0"
                        >
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <Label className="text-[10px]">Date</Label>
                              <Input
                                type="date"
                                className="bg-surface-50"
                                value={editDate}
                                onChange={(e) => setEditDate(e.target.value)}
                              />
                            </div>
                            <div>
                              <Label className="text-[10px]">Vehicle</Label>
                              <Select value={editVehicleId} onValueChange={setEditVehicleId}>
                                <SelectTrigger className="w-full">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {data.vehicles.map((v) => (
                                    <SelectItem key={v.id} value={v.id}>
                                      {v.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                          <div>
                            <Label className="text-[10px]">Trip Miles</Label>
                            <Input
                              type="number"
                              step="0.1"
                              min="0"
                              className="bg-surface-50"
                              value={editTripMiles}
                              onChange={(e) => setEditTripMiles(e.target.value)}
                              placeholder="24.5"
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <Label className="text-[10px]">Gallons</Label>
                              <Input
                                type="number"
                                step="0.001"
                                min="0"
                                className="bg-surface-50"
                                value={editGallons}
                                onChange={(e) => setEditGallons(e.target.value)}
                                placeholder="12.5"
                              />
                            </div>
                            <div>
                              <Label className="text-[10px]">Cost</Label>
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                className="bg-surface-50"
                                value={editTotalCost}
                                onChange={(e) => setEditTotalCost(e.target.value)}
                                placeholder="42.50"
                              />
                            </div>
                          </div>
                          <div>
                            <Label className="text-[10px]">Purpose</Label>
                            <Input
                              type="text"
                              className="bg-surface-50"
                              value={editPurpose}
                              onChange={(e) => setEditPurpose(e.target.value)}
                              placeholder="Feed store run"
                            />
                          </div>
                          <div className="flex gap-2 pt-1">
                            <Button
                              type="button"
                              className="flex-1 bg-teal-500 hover:bg-teal-400"
                              onClick={() => void handleUpdateEntry(entry.id)}
                            >
                              <Check className="w-3.5 h-3.5" /> Save
                            </Button>
                            <Button
                              type="button"
                              variant="secondary"
                              className="flex-1"
                              onClick={() => setEditingEntryId(null)}
                            >
                              <X className="w-3.5 h-3.5" /> Cancel
                            </Button>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div
                        key={entry.id}
                        className="px-4 py-3 border-b border-border/50 last:border-b-0"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-surface-950">
                              {entry.tripMiles ? `${entry.tripMiles.toFixed(1)} mi` : 'No miles'}
                              {entry.purpose && (
                                <span className="text-surface-600 font-normal">
                                  {' '}
                                  — {entry.purpose}
                                </span>
                              )}
                            </p>
                            <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-1">
                              <span className="text-[11px] text-surface-500">
                                {vehicle?.name || entry.vehicleId}
                              </span>
                              {entry.gallons ? (
                                <span className="text-[11px] text-surface-500">
                                  {entry.gallons.toFixed(1)} gal
                                </span>
                              ) : null}
                              {entry.totalCost ? (
                                <span className="text-[11px] text-surface-500">
                                  ${entry.totalCost.toFixed(2)}
                                </span>
                              ) : null}
                              {mpg ? (
                                <span className="text-[11px] text-teal-600 font-medium">
                                  {mpg} MPG
                                </span>
                              ) : null}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-sm font-bold text-teal-500 tabular-nums">
                              ${((entry.tripMiles || 0) * data.irsRate).toFixed(2)}
                            </p>
                            <p className="text-[11px] text-surface-500">
                              {new Date(entry.date + 'T00:00:00').toLocaleDateString('en-US', {
                                month: 'short',
                                day: 'numeric',
                              })}
                            </p>
                          </div>
                        </div>
                        <div className="flex gap-2 mt-2.5">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => startEditEntry(entry)}
                          >
                            <Pencil className="w-3 h-3" /> Edit
                          </Button>
                          <Button
                            type="button"
                            variant="ghost-danger"
                            size="sm"
                            onClick={() => void handleDelete(entry.id)}
                          >
                            <Trash2 className="w-3 h-3" /> Delete
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {/* Settings Modal — Vehicles & Addresses */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-md max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Mileage Settings</DialogTitle>
            <DialogDescription>Manage your vehicles and saved addresses.</DialogDescription>
          </DialogHeader>

          {/* Tab switcher */}
          <div className="flex rounded-lg bg-surface-100 p-0.5">
            <button
              type="button"
              onClick={() => setSettingsTab('vehicles')}
              className={`flex-1 flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                settingsTab === 'vehicles'
                  ? 'bg-white text-surface-900 shadow-sm'
                  : 'text-surface-500 hover:text-surface-700'
              }`}
            >
              <Car className="w-3.5 h-3.5" /> Vehicles
            </button>
            {geocodeEnabled && (
              <button
                type="button"
                onClick={() => setSettingsTab('addresses')}
                className={`flex-1 flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  settingsTab === 'addresses'
                    ? 'bg-white text-surface-900 shadow-sm'
                    : 'text-surface-500 hover:text-surface-700'
                }`}
              >
                <MapPin className="w-3.5 h-3.5" /> Addresses
              </button>
            )}
          </div>

          {/* Scrollable content */}
          <div className="overflow-y-auto -mx-6 px-6 flex-1 min-h-0">
            {/* ── Vehicles Tab ── */}
            {settingsTab === 'vehicles' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-surface-500 uppercase tracking-wider">
                    {data.vehicles.length} vehicle{data.vehicles.length !== 1 ? 's' : ''}
                  </span>
                  {showVehicleForm ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setShowVehicleForm(false)}
                    >
                      <X className="w-3 h-3" /> Cancel
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="text-teal-600 bg-teal-500/10 border-teal-500/20 hover:bg-teal-500/15"
                      onClick={() => setShowVehicleForm(true)}
                    >
                      <Plus className="w-3 h-3" /> Add
                    </Button>
                  )}
                </div>

                {showVehicleForm && (
                  <form
                    onSubmit={handleAddVehicle}
                    className="rounded-xl border border-border p-3 space-y-2"
                  >
                    <div className="grid grid-cols-[1fr_4.5rem] gap-2">
                      <Input
                        type="text"
                        value={newVehicleName}
                        onChange={(e) => setNewVehicleName(e.target.value)}
                        placeholder="Farm Truck"
                        required
                      />
                      <Input
                        type="number"
                        value={newVehicleYear}
                        onChange={(e) => setNewVehicleYear(e.target.value)}
                        placeholder="2020"
                        className="text-center"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        type="text"
                        value={newVehicleMake}
                        onChange={(e) => setNewVehicleMake(e.target.value)}
                        placeholder="Ford"
                      />
                      <Input
                        type="text"
                        value={newVehicleModel}
                        onChange={(e) => setNewVehicleModel(e.target.value)}
                        placeholder="F-150"
                      />
                    </div>
                    <Button type="submit" className="w-full bg-teal-500 hover:bg-teal-400">
                      Add Vehicle
                    </Button>
                  </form>
                )}

                <div className="rounded-xl border border-border overflow-hidden">
                  {data.vehicles.length === 0 && (
                    <p className="text-sm text-surface-500 text-center py-6">
                      No vehicles added yet
                    </p>
                  )}
                  {data.vehicles.map((vehicle) => {
                    const isEditing = editingVehicleId === vehicle.id;

                    if (isEditing) {
                      return (
                        <div
                          key={vehicle.id}
                          className="px-4 py-3 bg-surface-50 border-b border-border/50 last:border-b-0 space-y-2"
                        >
                          <div className="grid grid-cols-[1fr_4.5rem] gap-2">
                            <Input
                              type="text"
                              className="bg-surface-50"
                              value={editVehicleName}
                              onChange={(e) => setEditVehicleName(e.target.value)}
                              placeholder="Farm Truck"
                            />
                            <Input
                              type="number"
                              className="bg-surface-50 text-center"
                              value={editVehicleYear}
                              onChange={(e) => setEditVehicleYear(e.target.value)}
                              placeholder="2020"
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <Input
                              type="text"
                              className="bg-surface-50"
                              value={editVehicleMake}
                              onChange={(e) => setEditVehicleMake(e.target.value)}
                              placeholder="Ford"
                            />
                            <Input
                              type="text"
                              className="bg-surface-50"
                              value={editVehicleModel}
                              onChange={(e) => setEditVehicleModel(e.target.value)}
                              placeholder="F-150"
                            />
                          </div>
                          <div className="flex gap-2">
                            <Button
                              type="button"
                              className="flex-1 bg-teal-500 hover:bg-teal-400"
                              onClick={() => void handleUpdateVehicle(vehicle.id)}
                            >
                              <Check className="w-3.5 h-3.5" /> Save
                            </Button>
                            <Button
                              type="button"
                              variant="secondary"
                              className="flex-1"
                              onClick={() => setEditingVehicleId(null)}
                            >
                              <X className="w-3.5 h-3.5" /> Cancel
                            </Button>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div
                        key={vehicle.id}
                        className="px-4 py-3 border-b border-border/50 last:border-b-0"
                      >
                        <div className="min-w-0">
                          <span className="text-sm font-medium text-surface-900">
                            {vehicle.name}
                          </span>
                          {(vehicle.year || vehicle.make || vehicle.model) && (
                            <p className="text-[11px] text-surface-500 mt-0.5">
                              {[vehicle.year, vehicle.make, vehicle.model]
                                .filter(Boolean)
                                .join(' ')}
                            </p>
                          )}
                        </div>
                        <div className="flex gap-2 mt-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => startEditVehicle(vehicle)}
                          >
                            <Pencil className="w-3 h-3" /> Edit
                          </Button>
                          <Button
                            type="button"
                            variant="ghost-danger"
                            size="sm"
                            onClick={() => void handleDeleteVehicle(vehicle.id)}
                          >
                            <Trash2 className="w-3 h-3" /> Delete
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── Addresses Tab ── */}
            {settingsTab === 'addresses' && geocodeEnabled && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-surface-500 uppercase tracking-wider">
                    {savedAddresses.length} address{savedAddresses.length !== 1 ? 'es' : ''}
                  </span>
                  {showAddressForm ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setShowAddressForm(false)}
                    >
                      <X className="w-3 h-3" /> Cancel
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="text-teal-600 bg-teal-500/10 border-teal-500/20 hover:bg-teal-500/15"
                      onClick={() => setShowAddressForm(true)}
                    >
                      <Plus className="w-3 h-3" /> Add
                    </Button>
                  )}
                </div>

                {showAddressForm && (
                  <form
                    onSubmit={handleAddAddress}
                    className="rounded-xl border border-border p-3 space-y-2"
                  >
                    <Input
                      type="text"
                      value={newAddrLabel}
                      onChange={(e) => setNewAddrLabel(e.target.value)}
                      placeholder="Label (e.g., Home, Office)"
                      required
                    />
                    <AddressAutocomplete
                      label="Address"
                      placeholder="Search for address..."
                      value={newAddrSelected}
                      onChange={setNewAddrSelected}
                    />
                    <Button
                      type="submit"
                      className="w-full bg-teal-500 hover:bg-teal-400"
                      disabled={!newAddrLabel.trim() || !newAddrSelected}
                    >
                      Save Address
                    </Button>
                  </form>
                )}

                <div className="rounded-xl border border-border overflow-hidden">
                  {savedAddresses.length === 0 && (
                    <p className="text-sm text-surface-500 text-center py-6">
                      No saved addresses yet
                    </p>
                  )}
                  {savedAddresses.map((addr) => {
                    const isEditing = editingAddrId === addr.id;

                    if (isEditing) {
                      return (
                        <div
                          key={addr.id}
                          className="px-4 py-3 bg-surface-50 border-b border-border/50 last:border-b-0 space-y-2"
                        >
                          <div>
                            <Label className="text-[10px]">Label</Label>
                            <Input
                              type="text"
                              className="bg-surface-50"
                              value={editAddrLabel}
                              onChange={(e) => setEditAddrLabel(e.target.value)}
                            />
                          </div>
                          <p className="text-[11px] text-surface-500 truncate">{addr.formatted}</p>
                          <div className="flex gap-2">
                            <Button
                              type="button"
                              className="flex-1 bg-teal-500 hover:bg-teal-400"
                              onClick={() => void handleUpdateAddress(addr.id)}
                            >
                              <Check className="w-3.5 h-3.5" /> Save
                            </Button>
                            <Button
                              type="button"
                              variant="secondary"
                              className="flex-1"
                              onClick={() => setEditingAddrId(null)}
                            >
                              <X className="w-3.5 h-3.5" /> Cancel
                            </Button>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div
                        key={addr.id}
                        className="px-4 py-3 border-b border-border/50 last:border-b-0"
                      >
                        <div className="min-w-0">
                          <span className="text-sm font-medium text-surface-900">{addr.label}</span>
                          <p className="text-[11px] text-surface-500 truncate">{addr.formatted}</p>
                        </div>
                        <div className="flex gap-2 mt-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => startEditAddress(addr)}
                          >
                            <Pencil className="w-3 h-3" /> Edit
                          </Button>
                          <Button
                            type="button"
                            variant="ghost-danger"
                            size="sm"
                            onClick={() => void handleDeleteAddress(addr.id)}
                          >
                            <Trash2 className="w-3 h-3" /> Delete
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
