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
} from 'lucide-react';
import type { Vehicle, MileageEntry, MileageData, SavedAddress } from '../../types';
import { useAppContext } from '../../contexts/AppContext';
import { AddressAutocomplete } from './AddressAutocomplete';
import type { SelectedAddress } from './AddressAutocomplete';

const API = '/api/mileage';

// ── Standardized button styles ──────────────────────────────────────
const BTN = {
  primary: (color: string) =>
    `w-full py-3 bg-${color}-500 text-white font-semibold rounded-xl hover:bg-${color}-400 active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-sm`,
  savePrimary: (color: string) =>
    `flex-1 py-2.5 bg-${color}-500 text-white text-sm font-semibold rounded-xl hover:bg-${color}-400 active:scale-[0.98] transition-all flex items-center justify-center gap-1.5`,
  cancel:
    'flex-1 py-2.5 bg-surface-200 text-surface-700 text-sm font-semibold rounded-xl hover:bg-surface-300 active:scale-[0.98] transition-all flex items-center justify-center gap-1.5',
  action:
    'flex items-center gap-1.5 px-3 py-2 text-[12px] font-semibold text-surface-600 bg-surface-100 border border-border/50 rounded-xl hover:bg-surface-200 hover:text-surface-800 active:scale-[0.97] transition-all',
  actionDanger:
    'flex items-center gap-1.5 px-3 py-2 text-[12px] font-semibold text-surface-600 bg-surface-100 border border-border/50 rounded-xl hover:bg-danger-500/10 hover:text-danger-500 hover:border-danger-500/20 active:scale-[0.97] transition-all',
  addSection: (color: string) =>
    `flex items-center gap-1.5 px-3.5 py-2 text-[12px] font-semibold text-${color}-600 bg-${color}-500/10 border border-${color}-500/20 rounded-xl hover:bg-${color}-500/15 active:scale-[0.97] transition-all`,
  cancelSection:
    'flex items-center gap-1.5 px-3.5 py-2 text-[12px] font-semibold text-surface-600 bg-surface-100 border border-border/50 rounded-xl hover:bg-surface-200 active:scale-[0.97] transition-all',
} as const;

const INPUT =
  'w-full px-3 py-2.5 bg-surface-100 border border-border rounded-xl text-sm text-surface-950 placeholder:text-surface-500 focus:outline-none focus:ring-2 focus:ring-teal-400/30 focus:border-teal-400';
const INPUT_EDIT =
  'w-full px-2.5 py-2 bg-white border border-border rounded-xl text-sm text-surface-950 focus:outline-none focus:ring-2 focus:ring-teal-400/30 focus:border-teal-400';
const LABEL = 'text-[11px] text-surface-500 uppercase tracking-wider font-medium block mb-1';
const LABEL_SM = 'text-[10px] text-surface-500 uppercase tracking-wider font-medium';

export function MileageView() {
  const { selectedEntity, entities } = useAppContext();
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

  useEffect(() => { void fetchData(); }, [fetchData]);

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
      } catch { setGeocodeEnabled(false); }
    };
    void checkGeocode();
  }, []);

  const savedAddresses: SavedAddress[] = data.savedAddresses || [];

  useEffect(() => {
    if (!fromAddress || !toAddress) { setRouteMiles(null); return; }
    const fetchRoute = async () => {
      setRouteLoading(true);
      try {
        const params = new URLSearchParams({ from_lat: String(fromAddress.lat), from_lon: String(fromAddress.lon), to_lat: String(toAddress.lat), to_lon: String(toAddress.lon) });
        const res = await fetch(`/api/geocode/route?${params}`);
        const d = await res.json();
        if (d.miles != null) { setRouteMiles(d.miles); setTripMiles(String(d.miles)); }
      } catch (err) { console.error('Route calculation error:', err); }
      finally { setRouteLoading(false); }
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
      const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (res.ok) {
        setOdometerStart(''); setOdometerEnd(''); setTripMiles(''); setGallons(''); setTotalCost(''); setPurpose('');
        setFromAddress(null); setToAddress(null); setRouteMiles(null);
        setDate(new Date().toISOString().split('T')[0]);
        await fetchData();
      }
    } finally { setSubmitting(false); }
  };

  const handleDelete = async (id: string) => { await fetch(`${API}/${id}`, { method: 'DELETE' }); await fetchData(); };

  const startEditEntry = (entry: MileageEntry) => {
    setEditingEntryId(entry.id); setEditDate(entry.date); setEditVehicleId(entry.vehicleId);
    setEditTripMiles(entry.tripMiles != null ? String(entry.tripMiles) : '');
    setEditGallons(entry.gallons != null ? String(entry.gallons) : '');
    setEditTotalCost(entry.totalCost != null ? String(entry.totalCost) : '');
    setEditPurpose(entry.purpose || '');
    setEditOdometerStart(entry.odometerStart != null ? String(entry.odometerStart) : '');
    setEditOdometerEnd(entry.odometerEnd != null ? String(entry.odometerEnd) : '');
  };

  const handleUpdateEntry = async (id: string) => {
    await fetch(`${API}/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: editDate, vehicleId: editVehicleId, tripMiles: editTripMiles || '', gallons: editGallons || '', totalCost: editTotalCost || '', purpose: editPurpose, odometerStart: editOdometerStart || '', odometerEnd: editOdometerEnd || '' }),
    });
    setEditingEntryId(null); await fetchData();
  };

  // Vehicle CRUD
  const handleAddVehicle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newVehicleName.trim()) return;
    const body: Record<string, unknown> = { name: newVehicleName.trim() };
    if (newVehicleYear) body.year = parseInt(newVehicleYear);
    if (newVehicleMake.trim()) body.make = newVehicleMake.trim();
    if (newVehicleModel.trim()) body.model = newVehicleModel.trim();
    await fetch(`${API}/vehicles`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    setNewVehicleName(''); setNewVehicleYear(''); setNewVehicleMake(''); setNewVehicleModel('');
    setShowVehicleForm(false); await fetchData();
  };

  const handleDeleteVehicle = async (id: string) => { await fetch(`${API}/vehicles/${id}`, { method: 'DELETE' }); await fetchData(); };

  const startEditVehicle = (v: Vehicle) => {
    setEditingVehicleId(v.id); setEditVehicleName(v.name);
    setEditVehicleYear(v.year != null ? String(v.year) : '');
    setEditVehicleMake(v.make || ''); setEditVehicleModel(v.model || '');
  };

  const handleUpdateVehicle = async (id: string) => {
    await fetch(`${API}/vehicles/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: editVehicleName.trim(), year: editVehicleYear || '', make: editVehicleMake.trim(), model: editVehicleModel.trim() }),
    });
    setEditingVehicleId(null); await fetchData();
  };

  // Address CRUD
  const handleAddAddress = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAddrLabel.trim() || !newAddrSelected) return;
    await fetch(`${API}/addresses`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label: newAddrLabel.trim(), formatted: newAddrSelected.formatted, lat: newAddrSelected.lat, lon: newAddrSelected.lon }) });
    setNewAddrLabel(''); setNewAddrSelected(null); setShowAddressForm(false); await fetchData();
  };

  const handleDeleteAddress = async (id: string) => { await fetch(`${API}/addresses/${id}`, { method: 'DELETE' }); await fetchData(); };

  const startEditAddress = (a: SavedAddress) => { setEditingAddrId(a.id); setEditAddrLabel(a.label); };

  const handleUpdateAddress = async (id: string) => {
    await fetch(`${API}/addresses/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label: editAddrLabel.trim() }) });
    setEditingAddrId(null); await fetchData();
  };

  // ── Derived data ──────────────────────────────────────────────────
  const filteredEntries = selectedEntity === 'all' ? data.entries : data.entries.filter((e) => e.entity === selectedEntity);
  const entityName = entities.find((e) => e.id === selectedEntity)?.name;

  const entriesByMonth = filteredEntries.slice().sort((a, b) => b.date.localeCompare(a.date))
    .reduce<Record<string, MileageEntry[]>>((acc, entry) => { const m = entry.date.substring(0, 7); if (!acc[m]) acc[m] = []; acc[m].push(entry); return acc; }, {});
  const months = Object.keys(entriesByMonth).sort((a, b) => b.localeCompare(a));
  const currentMonth = new Date().toISOString().substring(0, 7);
  const activeMonth = expandedMonth ?? currentMonth;
  const currentMonthEntries = entriesByMonth[currentMonth] || [];
  const currentMonthMiles = currentMonthEntries.reduce((sum, e) => sum + (e.tripMiles || 0), 0);
  const irsDeduction = currentMonthMiles * data.irsRate;
  const allTimeMiles = filteredEntries.reduce((sum, e) => sum + (e.tripMiles || 0), 0);
  const allTimeDeduction = allTimeMiles * data.irsRate;
  const fillUps = filteredEntries.filter((e) => e.gallons && e.gallons > 0 && e.tripMiles && e.tripMiles > 0);
  const avgMpg = fillUps.length > 0 ? fillUps.reduce((sum, e) => sum + e.tripMiles! / e.gallons!, 0) / fillUps.length : 0;

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin w-6 h-6 border-2 border-teal-400 border-t-transparent rounded-full" /></div>;
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-6 space-y-5 overflow-x-hidden">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2.5 bg-teal-500/10 rounded-xl"><Fuel className="w-6 h-6 text-teal-500" /></div>
        <div className="min-w-0">
          <h1 className="font-display text-xl text-surface-950 italic">Mileage Tracker</h1>
          <p className="text-[12px] text-surface-600 truncate">{entityName || (selectedEntity === 'all' ? 'All Entities' : selectedEntity)} · IRS Rate: ${data.irsRate.toFixed(2)}/mile</p>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-3 gap-2">
        <div className="glass-card rounded-xl p-3">
          <p className="text-[10px] text-surface-500 uppercase tracking-wider font-medium">This Month</p>
          <p className="text-lg font-bold text-surface-950 tabular-nums mt-0.5">{currentMonthMiles.toFixed(0)}</p>
          <p className="text-[10px] text-surface-500">miles</p>
        </div>
        <div className="glass-card rounded-xl p-3">
          <p className="text-[10px] text-surface-500 uppercase tracking-wider font-medium">IRS Deduct</p>
          <p className="text-lg font-bold text-teal-500 tabular-nums mt-0.5">${irsDeduction.toFixed(0)}</p>
          <p className="text-[10px] text-surface-500">this month</p>
        </div>
        <div className="glass-card rounded-xl p-3">
          <p className="text-[10px] text-surface-500 uppercase tracking-wider font-medium">Avg MPG</p>
          <p className="text-lg font-bold text-surface-950 tabular-nums mt-0.5">{avgMpg > 0 ? avgMpg.toFixed(1) : '—'}</p>
          <p className="text-[10px] text-surface-500">{fillUps.length} fill-up{fillUps.length !== 1 ? 's' : ''}</p>
        </div>
      </div>

      {/* All-time bar */}
      <div className="glass-card rounded-xl px-4 py-2.5 flex items-center justify-between">
        <span className="text-[11px] text-surface-500 uppercase tracking-wider font-medium">All Time</span>
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-surface-900 tabular-nums">{allTimeMiles.toFixed(0)} mi</span>
          <span className="text-sm font-bold text-teal-500 tabular-nums">${allTimeDeduction.toFixed(2)}</span>
        </div>
      </div>

      {/* New Entry Form */}
      <form onSubmit={handleSubmit} className="glass-card rounded-xl p-4 space-y-3">
        <h2 className="text-sm font-semibold text-surface-900 flex items-center gap-2"><Plus className="w-4 h-4 text-teal-500" /> New Entry</h2>

        <div className="grid grid-cols-2 gap-3">
          <div><label className={LABEL}>Date</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={INPUT} /></div>
          <div>
            <label className={LABEL}>Vehicle</label>
            <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} className={INPUT}>
              {data.vehicles.length === 0 && <option value="">Add a vehicle first</option>}
              {data.vehicles.map((v) => <option key={v.id} value={v.id}>{v.name}{v.year ? ` (${v.year})` : ''}</option>)}
            </select>
          </div>
        </div>

        {geocodeEnabled && (
          <div className="space-y-2">
            <div>
              <AddressAutocomplete label="From" placeholder="Start address..." value={fromAddress} onChange={setFromAddress} />
              {savedAddresses.length > 0 && !fromAddress && (
                <div className="flex gap-1.5 mt-1.5 flex-wrap">
                  {savedAddresses.map((addr) => (
                    <button key={addr.id} type="button" onClick={() => setFromAddress({ formatted: addr.formatted, lat: addr.lat, lon: addr.lon })}
                      className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-surface-600 hover:text-teal-500 bg-surface-100 border border-border rounded-lg hover:border-teal-400/30 transition-colors" title={addr.formatted}>
                      <Home className="w-3 h-3" />{addr.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div>
              <AddressAutocomplete label="To" placeholder="Destination address..." value={toAddress} onChange={setToAddress} />
              {savedAddresses.length > 0 && !toAddress && (
                <div className="flex gap-1.5 mt-1.5 flex-wrap">
                  {savedAddresses.map((addr) => (
                    <button key={addr.id} type="button" onClick={() => setToAddress({ formatted: addr.formatted, lat: addr.lat, lon: addr.lon })}
                      className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-surface-600 hover:text-teal-500 bg-surface-100 border border-border rounded-lg hover:border-teal-400/30 transition-colors" title={addr.formatted}>
                      <Home className="w-3 h-3" />{addr.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {routeLoading && <div className="flex items-center gap-2 text-[12px] text-surface-500"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Calculating distance...</div>}
            {routeMiles != null && !routeLoading && <div className="flex items-center gap-2 text-[12px] text-teal-500 font-medium"><MapPin className="w-3.5 h-3.5" /> Driving distance: {routeMiles} miles</div>}
          </div>
        )}

        <div>
          <label className={LABEL}>
            Trip Miles
            {geocodeEnabled && <span className="text-surface-400 font-normal normal-case ml-1">{routeMiles != null ? '(auto, editable)' : 'or enter manually'}</span>}
          </label>
          <input type="number" step="0.1" min="0" value={tripMiles} onChange={(e) => setTripMiles(e.target.value)} placeholder="Miles driven" className={INPUT} />
        </div>

        <button type="button" onClick={() => setShowDetails(!showDetails)} className="flex items-center gap-1.5 text-[12px] text-teal-500 hover:text-teal-400 font-medium transition-colors">
          {showDetails ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          {showDetails ? 'Hide Details' : 'Gas & Odometer Details'}
        </button>

        {showDetails && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><label className={LABEL}>Odo Start</label><input type="number" step="0.1" min="0" value={odometerStart} onChange={(e) => setOdometerStart(e.target.value)} placeholder="Start" className={INPUT} /></div>
              <div><label className={LABEL}>Odo End</label><input type="number" step="0.1" min="0" value={odometerEnd} onChange={(e) => setOdometerEnd(e.target.value)} placeholder="End" className={INPUT} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={LABEL}>Gallons</label><input type="number" step="0.001" min="0" value={gallons} onChange={(e) => setGallons(e.target.value)} placeholder="Gal" className={INPUT} /></div>
              <div><label className={LABEL}>Total Cost</label><input type="number" step="0.01" min="0" value={totalCost} onChange={(e) => setTotalCost(e.target.value)} placeholder="$" className={INPUT} /></div>
            </div>
            <div><label className={LABEL}>Purpose</label><input type="text" value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. Client meeting, Office commute" className={INPUT} /></div>
          </div>
        )}

        <button type="submit" disabled={submitting || !vehicleId} className={BTN.primary('teal')}>
          <MapPin className="w-4 h-4" /> Record Trip{tripMiles ? ` — ${parseFloat(tripMiles).toFixed(1)} mi` : ''}
        </button>
      </form>

      {/* Trip History */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-surface-900">Trip History</h2>

        {months.length === 0 && (
          <div className="glass-card rounded-xl py-10 text-center">
            <Car className="w-8 h-8 text-surface-300 mx-auto mb-2" />
            <p className="text-sm text-surface-500">No trips recorded yet</p>
          </div>
        )}

        {months.map((month) => {
          const entries = entriesByMonth[month];
          const monthMiles = entries.reduce((sum, e) => sum + (e.tripMiles || 0), 0);
          const monthDeduction = monthMiles * data.irsRate;
          const isExpanded = activeMonth === month;
          const monthLabel = new Date(month + '-01T00:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

          return (
            <div key={month} className="glass-card rounded-xl overflow-hidden">
              <button onClick={() => setExpandedMonth(isExpanded ? null : month)} className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-surface-100/50 transition-colors">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm font-medium text-surface-900 truncate">{monthLabel}</span>
                  <span className="text-[11px] text-surface-500 shrink-0">({entries.length})</span>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-2">
                  <span className="text-sm font-bold text-teal-500 tabular-nums">{monthMiles.toFixed(0)} mi</span>
                  {isExpanded ? <ChevronUp className="w-4 h-4 text-surface-400" /> : <ChevronDown className="w-4 h-4 text-surface-400" />}
                </div>
              </button>

              {isExpanded && (
                <div className="border-t border-border">
                  <div className="px-4 py-2 bg-teal-500/5 flex items-center justify-between">
                    <span className="text-[11px] text-teal-600 font-medium uppercase tracking-wider">Month Deduction</span>
                    <span className="text-sm font-bold text-teal-500 tabular-nums">${monthDeduction.toFixed(2)}</span>
                  </div>

                  {entries.map((entry) => {
                    const vehicle = data.vehicles.find((v) => v.id === entry.vehicleId);
                    const mpg = entry.gallons && entry.gallons > 0 && entry.tripMiles ? (entry.tripMiles / entry.gallons).toFixed(1) : null;
                    const isEditing = editingEntryId === entry.id;

                    if (isEditing) {
                      return (
                        <div key={entry.id} className="px-4 py-3 space-y-2 bg-surface-50 border-b border-border/50 last:border-b-0">
                          <div className="grid grid-cols-2 gap-2">
                            <div><label className={LABEL_SM}>Date</label><input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} className={INPUT_EDIT} /></div>
                            <div>
                              <label className={LABEL_SM}>Vehicle</label>
                              <select value={editVehicleId} onChange={(e) => setEditVehicleId(e.target.value)} className={INPUT_EDIT}>
                                {data.vehicles.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                              </select>
                            </div>
                          </div>
                          <div><label className={LABEL_SM}>Trip Miles</label><input type="number" step="0.1" min="0" value={editTripMiles} onChange={(e) => setEditTripMiles(e.target.value)} placeholder="Miles" className={INPUT_EDIT} /></div>
                          <div className="grid grid-cols-2 gap-2">
                            <div><label className={LABEL_SM}>Gallons</label><input type="number" step="0.001" min="0" value={editGallons} onChange={(e) => setEditGallons(e.target.value)} placeholder="Gal" className={INPUT_EDIT} /></div>
                            <div><label className={LABEL_SM}>Cost</label><input type="number" step="0.01" min="0" value={editTotalCost} onChange={(e) => setEditTotalCost(e.target.value)} placeholder="$" className={INPUT_EDIT} /></div>
                          </div>
                          <div><label className={LABEL_SM}>Purpose</label><input type="text" value={editPurpose} onChange={(e) => setEditPurpose(e.target.value)} placeholder="Purpose" className={INPUT_EDIT} /></div>
                          <div className="flex gap-2 pt-1">
                            <button type="button" onClick={() => void handleUpdateEntry(entry.id)} className={BTN.savePrimary('teal')}><Check className="w-3.5 h-3.5" /> Save</button>
                            <button type="button" onClick={() => setEditingEntryId(null)} className={BTN.cancel}><X className="w-3.5 h-3.5" /> Cancel</button>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div key={entry.id} className="px-4 py-3 border-b border-border/50 last:border-b-0">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-surface-950">
                              {entry.tripMiles ? `${entry.tripMiles.toFixed(1)} mi` : 'No miles'}
                              {entry.purpose && <span className="text-surface-600 font-normal"> — {entry.purpose}</span>}
                            </p>
                            <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-1">
                              <span className="text-[11px] text-surface-500">{vehicle?.name || entry.vehicleId}</span>
                              {entry.gallons ? <span className="text-[11px] text-surface-500">{entry.gallons.toFixed(1)} gal</span> : null}
                              {entry.totalCost ? <span className="text-[11px] text-surface-500">${entry.totalCost.toFixed(2)}</span> : null}
                              {mpg ? <span className="text-[11px] text-teal-600 font-medium">{mpg} MPG</span> : null}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-sm font-bold text-teal-500 tabular-nums">${((entry.tripMiles || 0) * data.irsRate).toFixed(2)}</p>
                            <p className="text-[11px] text-surface-500">{new Date(entry.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</p>
                          </div>
                        </div>
                        <div className="flex gap-2 mt-2.5">
                          <button onClick={() => startEditEntry(entry)} className={BTN.action}><Pencil className="w-3 h-3" /> Edit</button>
                          <button onClick={() => void handleDelete(entry.id)} className={BTN.actionDanger}><Trash2 className="w-3 h-3" /> Delete</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Vehicles */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-surface-900 flex items-center gap-2"><Car className="w-4 h-4 text-surface-600" /> Vehicles</h2>
          <button onClick={() => setShowVehicleForm(!showVehicleForm)} className={showVehicleForm ? BTN.cancelSection : BTN.addSection('teal')}>
            {showVehicleForm ? <><X className="w-3 h-3" /> Cancel</> : <><Plus className="w-3 h-3" /> Add</>}
          </button>
        </div>

        {showVehicleForm && (
          <form onSubmit={handleAddVehicle} className="glass-card rounded-xl p-3 space-y-2">
            <div className="grid grid-cols-[1fr,4.5rem] gap-2">
              <input type="text" value={newVehicleName} onChange={(e) => setNewVehicleName(e.target.value)} placeholder="Vehicle name" required className={INPUT} />
              <input type="number" value={newVehicleYear} onChange={(e) => setNewVehicleYear(e.target.value)} placeholder="Year" className={`${INPUT} text-center`} />
            </div>
            <div className="grid grid-cols-[1fr,1fr] gap-2">
              <input type="text" value={newVehicleMake} onChange={(e) => setNewVehicleMake(e.target.value)} placeholder="Make" className={INPUT} />
              <input type="text" value={newVehicleModel} onChange={(e) => setNewVehicleModel(e.target.value)} placeholder="Model" className={INPUT} />
            </div>
            <button type="submit" className="w-full py-2.5 bg-teal-500 text-white font-semibold rounded-xl hover:bg-teal-400 active:scale-[0.98] transition-all text-sm">Add Vehicle</button>
          </form>
        )}

        <div className="glass-card rounded-xl overflow-hidden">
          {data.vehicles.length === 0 && <p className="text-sm text-surface-500 text-center py-6">No vehicles added yet</p>}
          {data.vehicles.map((vehicle) => {
            const isEditing = editingVehicleId === vehicle.id;

            if (isEditing) {
              return (
                <div key={vehicle.id} className="px-4 py-3 bg-surface-50 border-b border-border/50 last:border-b-0 space-y-2">
                  <div className="grid grid-cols-[1fr,4.5rem] gap-2">
                    <input type="text" value={editVehicleName} onChange={(e) => setEditVehicleName(e.target.value)} className={INPUT_EDIT} placeholder="Name" />
                    <input type="number" value={editVehicleYear} onChange={(e) => setEditVehicleYear(e.target.value)} className={`${INPUT_EDIT} text-center`} placeholder="Year" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input type="text" value={editVehicleMake} onChange={(e) => setEditVehicleMake(e.target.value)} className={INPUT_EDIT} placeholder="Make" />
                    <input type="text" value={editVehicleModel} onChange={(e) => setEditVehicleModel(e.target.value)} className={INPUT_EDIT} placeholder="Model" />
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => void handleUpdateVehicle(vehicle.id)} className={BTN.savePrimary('teal')}><Check className="w-3.5 h-3.5" /> Save</button>
                    <button type="button" onClick={() => setEditingVehicleId(null)} className={BTN.cancel}><X className="w-3.5 h-3.5" /> Cancel</button>
                  </div>
                </div>
              );
            }

            return (
              <div key={vehicle.id} className="px-4 py-3 border-b border-border/50 last:border-b-0">
                <div className="min-w-0">
                  <span className="text-sm font-medium text-surface-900">{vehicle.name}</span>
                  {(vehicle.year || vehicle.make || vehicle.model) && (
                    <p className="text-[11px] text-surface-500 mt-0.5">{[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ')}</p>
                  )}
                </div>
                <div className="flex gap-2 mt-2">
                  <button onClick={() => startEditVehicle(vehicle)} className={BTN.action}><Pencil className="w-3 h-3" /> Edit</button>
                  <button onClick={() => void handleDeleteVehicle(vehicle.id)} className={BTN.actionDanger}><Trash2 className="w-3 h-3" /> Delete</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Saved Addresses */}
      {geocodeEnabled && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-surface-900 flex items-center gap-2"><MapPin className="w-4 h-4 text-surface-600" /> Saved Addresses</h2>
            <button onClick={() => setShowAddressForm(!showAddressForm)} className={showAddressForm ? BTN.cancelSection : BTN.addSection('teal')}>
              {showAddressForm ? <><X className="w-3 h-3" /> Cancel</> : <><Plus className="w-3 h-3" /> Add</>}
            </button>
          </div>

          {showAddressForm && (
            <form onSubmit={handleAddAddress} className="glass-card rounded-xl p-3 space-y-2">
              <input type="text" value={newAddrLabel} onChange={(e) => setNewAddrLabel(e.target.value)} placeholder="Label (e.g., Home, Office)" required className={INPUT} />
              <AddressAutocomplete label="Address" placeholder="Search for address..." value={newAddrSelected} onChange={setNewAddrSelected} />
              <button type="submit" disabled={!newAddrLabel.trim() || !newAddrSelected} className="w-full py-2.5 bg-teal-500 text-white font-semibold rounded-xl hover:bg-teal-400 active:scale-[0.98] transition-all disabled:opacity-40 text-sm">Save Address</button>
            </form>
          )}

          <div className="glass-card rounded-xl overflow-hidden">
            {savedAddresses.length === 0 && <p className="text-sm text-surface-500 text-center py-6">No saved addresses yet</p>}
            {savedAddresses.map((addr) => {
              const isEditing = editingAddrId === addr.id;

              if (isEditing) {
                return (
                  <div key={addr.id} className="px-4 py-3 bg-surface-50 border-b border-border/50 last:border-b-0 space-y-2">
                    <div>
                      <label className={LABEL_SM}>Label</label>
                      <input type="text" value={editAddrLabel} onChange={(e) => setEditAddrLabel(e.target.value)} className={INPUT_EDIT} />
                    </div>
                    <p className="text-[11px] text-surface-500 truncate">{addr.formatted}</p>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => void handleUpdateAddress(addr.id)} className={BTN.savePrimary('teal')}><Check className="w-3.5 h-3.5" /> Save</button>
                      <button type="button" onClick={() => setEditingAddrId(null)} className={BTN.cancel}><X className="w-3.5 h-3.5" /> Cancel</button>
                    </div>
                  </div>
                );
              }

              return (
                <div key={addr.id} className="px-4 py-3 border-b border-border/50 last:border-b-0">
                  <div className="min-w-0">
                    <span className="text-sm font-medium text-surface-900">{addr.label}</span>
                    <p className="text-[11px] text-surface-500 truncate">{addr.formatted}</p>
                  </div>
                  <div className="flex gap-2 mt-2">
                    <button onClick={() => startEditAddress(addr)} className={BTN.action}><Pencil className="w-3 h-3" /> Edit</button>
                    <button onClick={() => void handleDeleteAddress(addr.id)} className={BTN.actionDanger}><Trash2 className="w-3 h-3" /> Delete</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
