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
} from 'lucide-react';
import type { Vehicle, MileageEntry, MileageData } from '../../types';
import { useAppContext } from '../../contexts/AppContext';
import { AddressAutocomplete } from './AddressAutocomplete';
import type { SelectedAddress } from './AddressAutocomplete';

const API = '/api/mileage';

export function MileageView() {
  const { selectedEntity, entities } = useAppContext();
  const [data, setData] = useState<MileageData>({
    vehicles: [],
    entries: [],
    irsRate: 0.7,
  });
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

  // Address autocomplete state
  const [geocodeEnabled, setGeocodeEnabled] = useState(false);
  const [fromAddress, setFromAddress] = useState<SelectedAddress | null>(null);
  const [toAddress, setToAddress] = useState<SelectedAddress | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeMiles, setRouteMiles] = useState<number | null>(null);

  // UI state
  const [showVehicleForm, setShowVehicleForm] = useState(false);
  const [newVehicleName, setNewVehicleName] = useState('');
  const [newVehicleYear, setNewVehicleYear] = useState('');
  const [newVehicleMake, setNewVehicleMake] = useState('');
  const [newVehicleModel, setNewVehicleModel] = useState('');
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);

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

  // Auto-calculate trip miles from odometer
  useEffect(() => {
    if (odometerStart && odometerEnd) {
      const start = parseFloat(odometerStart);
      const end = parseFloat(odometerEnd);
      if (!isNaN(start) && !isNaN(end) && end > start) {
        setTripMiles(String(end - start));
      }
    }
  }, [odometerStart, odometerEnd]);

  // Check if geocode (Geoapify) is enabled
  useEffect(() => {
    const checkGeocode = async () => {
      try {
        const res = await fetch('/api/geocode/enabled');
        const data = await res.json();
        setGeocodeEnabled(data.enabled === true);
      } catch {
        setGeocodeEnabled(false);
      }
    };
    void checkGeocode();
  }, []);

  // Auto-calculate driving distance when both addresses are selected
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
        const data = await res.json();
        if (data.miles != null) {
          setRouteMiles(data.miles);
          setTripMiles(String(data.miles));
        }
      } catch (err) {
        console.error('Route calculation error:', err);
      } finally {
        setRouteLoading(false);
      }
    };
    void fetchRoute();
  }, [fromAddress, toAddress]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vehicleId) return;

    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        vehicleId,
        date,
      };
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
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (entryId: string) => {
    await fetch(`${API}/${entryId}`, { method: 'DELETE' });
    await fetchData();
  };

  const handleAddVehicle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newVehicleName.trim()) return;

    const body: Record<string, unknown> = {
      name: newVehicleName.trim(),
    };
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

  // Filter entries by selected entity
  const filteredEntries = selectedEntity === 'all'
    ? data.entries
    : data.entries.filter((e) => e.entity === selectedEntity);

  const entityName = entities.find((e) => e.id === selectedEntity)?.name;

  // Group entries by month (most recent first)
  const entriesByMonth = filteredEntries
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date))
    .reduce<Record<string, MileageEntry[]>>((acc, entry) => {
      const month = entry.date.substring(0, 7); // YYYY-MM
      if (!acc[month]) acc[month] = [];
      acc[month].push(entry);
      return acc;
    }, {});

  const months = Object.keys(entriesByMonth).sort((a, b) => b.localeCompare(a));

  // Auto-expand current month
  const currentMonth = new Date().toISOString().substring(0, 7);
  const activeMonth = expandedMonth ?? currentMonth;

  // Stats
  const currentMonthEntries = entriesByMonth[currentMonth] || [];
  const currentMonthMiles = currentMonthEntries.reduce(
    (sum, e) => sum + (e.tripMiles || 0),
    0,
  );
  const irsDeduction = currentMonthMiles * data.irsRate;

  // Average MPG from all entries that have both gallons and tripMiles
  const fillUps = filteredEntries.filter((e) => e.gallons && e.gallons > 0 && e.tripMiles && e.tripMiles > 0);
  const avgMpg =
    fillUps.length > 0
      ? fillUps.reduce((sum, e) => sum + (e.tripMiles! / e.gallons!), 0) / fillUps.length
      : 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-6 h-6 border-2 border-teal-400 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2.5 bg-teal-500/10 rounded-xl">
          <Fuel className="w-6 h-6 text-teal-500" />
        </div>
        <div>
          <h1 className="font-display text-xl text-surface-950 italic">
            Mileage Tracker
          </h1>
          <p className="text-[12px] text-surface-600">
            {entityName || (selectedEntity === 'all' ? 'All Entities' : selectedEntity)}
            {' · '}IRS Rate: ${data.irsRate.toFixed(2)}/mile
          </p>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="glass-card rounded-xl p-3">
          <p className="text-[11px] text-surface-600 uppercase tracking-wider">
            This Month
          </p>
          <p className="text-xl font-semibold text-surface-950 tabular-nums">
            {currentMonthMiles.toFixed(0)}
          </p>
          <p className="text-[10px] text-surface-500">miles</p>
        </div>
        <div className="glass-card rounded-xl p-3">
          <p className="text-[11px] text-surface-600 uppercase tracking-wider">
            IRS Deduction
          </p>
          <p className="text-xl font-semibold text-teal-500 tabular-nums">
            ${irsDeduction.toFixed(2)}
          </p>
          <p className="text-[10px] text-surface-500">this month</p>
        </div>
        <div className="glass-card rounded-xl p-3">
          <p className="text-[11px] text-surface-600 uppercase tracking-wider">
            Avg MPG
          </p>
          <p className="text-xl font-semibold text-surface-950 tabular-nums">
            {avgMpg > 0 ? avgMpg.toFixed(1) : '—'}
          </p>
          <p className="text-[10px] text-surface-500">from fill-ups</p>
        </div>
      </div>

      {/* Quick Entry Form */}
      <form onSubmit={handleSubmit} className="glass-card rounded-xl p-4 space-y-3">
        <h2 className="text-sm font-semibold text-surface-900 flex items-center gap-2">
          <Plus className="w-4 h-4 text-teal-400" />
          New Entry
        </h2>

        {/* Date */}
        <div>
          <label className="text-[11px] text-surface-600 uppercase tracking-wider block mb-1">
            Date
          </label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full px-3 py-2.5 bg-surface-100 border border-border rounded-lg text-sm text-surface-950 focus:outline-none focus:ring-2 focus:ring-teal-400/30 focus:border-teal-400"
          />
        </div>

        {/* Vehicle */}
        <div>
          <label className="text-[11px] text-surface-600 uppercase tracking-wider block mb-1">
            Vehicle
          </label>
          <select
            value={vehicleId}
            onChange={(e) => setVehicleId(e.target.value)}
            className="w-full px-3 py-2.5 bg-surface-100 border border-border rounded-lg text-sm text-surface-950 focus:outline-none focus:ring-2 focus:ring-teal-400/30 focus:border-teal-400"
          >
            {data.vehicles.length === 0 && (
              <option value="">Add a vehicle first</option>
            )}
            {data.vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
                {v.year ? ` (${v.year})` : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Address Autocomplete (only if Geoapify API key is set) */}
        {geocodeEnabled && (
          <div className="space-y-2">
            <AddressAutocomplete
              label="From"
              placeholder="Start address..."
              value={fromAddress}
              onChange={setFromAddress}
            />
            <AddressAutocomplete
              label="To"
              placeholder="Destination address..."
              value={toAddress}
              onChange={setToAddress}
            />
            {routeLoading && (
              <div className="flex items-center gap-2 text-[12px] text-surface-500">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Calculating distance...
              </div>
            )}
            {routeMiles != null && !routeLoading && (
              <div className="flex items-center gap-2 text-[12px] text-teal-500">
                <MapPin className="w-3.5 h-3.5" />
                Driving distance: {routeMiles} miles
              </div>
            )}
          </div>
        )}

        {/* Trip Miles (always visible) */}
        <div>
          <label className="text-[11px] text-surface-600 uppercase tracking-wider block mb-1">
            Trip Miles
            {geocodeEnabled && (
              <span className="text-surface-500 font-normal ml-1">
                {routeMiles != null ? '(auto-calculated, editable)' : 'or enter miles manually'}
              </span>
            )}
          </label>
          <input
            type="number"
            step="0.1"
            min="0"
            value={tripMiles}
            onChange={(e) => setTripMiles(e.target.value)}
            placeholder="Miles driven"
            className="w-full px-3 py-2.5 bg-surface-100 border border-border rounded-lg text-sm text-surface-950 placeholder:text-surface-500 focus:outline-none focus:ring-2 focus:ring-teal-400/30 focus:border-teal-400"
          />
        </div>

        {/* Collapsible Details */}
        <button
          type="button"
          onClick={() => setShowDetails(!showDetails)}
          className="flex items-center gap-1.5 text-[12px] text-teal-500 hover:text-teal-400 transition-colors"
        >
          {showDetails ? (
            <ChevronUp className="w-3.5 h-3.5" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5" />
          )}
          Details
        </button>

        {showDetails && (
          <div className="space-y-3">
            {/* Odometer Start / End */}
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-[11px] text-surface-600 uppercase tracking-wider block mb-1">
                  Odo Start
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={odometerStart}
                  onChange={(e) => setOdometerStart(e.target.value)}
                  placeholder="Start"
                  className="w-full px-3 py-2.5 bg-surface-100 border border-border rounded-lg text-sm text-surface-950 placeholder:text-surface-500 focus:outline-none focus:ring-2 focus:ring-teal-400/30 focus:border-teal-400"
                />
              </div>
              <div className="flex-1">
                <label className="text-[11px] text-surface-600 uppercase tracking-wider block mb-1">
                  Odo End
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={odometerEnd}
                  onChange={(e) => setOdometerEnd(e.target.value)}
                  placeholder="End"
                  className="w-full px-3 py-2.5 bg-surface-100 border border-border rounded-lg text-sm text-surface-950 placeholder:text-surface-500 focus:outline-none focus:ring-2 focus:ring-teal-400/30 focus:border-teal-400"
                />
              </div>
            </div>

            {/* Gallons / Total Cost */}
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-[11px] text-surface-600 uppercase tracking-wider block mb-1">
                  Gallons
                </label>
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  value={gallons}
                  onChange={(e) => setGallons(e.target.value)}
                  placeholder="Gal"
                  className="w-full px-3 py-2.5 bg-surface-100 border border-border rounded-lg text-sm text-surface-950 placeholder:text-surface-500 focus:outline-none focus:ring-2 focus:ring-teal-400/30 focus:border-teal-400"
                />
              </div>
              <div className="flex-1">
                <label className="text-[11px] text-surface-600 uppercase tracking-wider block mb-1">
                  Total Cost
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={totalCost}
                  onChange={(e) => setTotalCost(e.target.value)}
                  placeholder="$"
                  className="w-full px-3 py-2.5 bg-surface-100 border border-border rounded-lg text-sm text-surface-950 placeholder:text-surface-500 focus:outline-none focus:ring-2 focus:ring-teal-400/30 focus:border-teal-400"
                />
              </div>
            </div>

            {/* Purpose */}
            <div>
              <label className="text-[11px] text-surface-600 uppercase tracking-wider block mb-1">
                Purpose
              </label>
              <input
                type="text"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                placeholder="e.g. Client meeting, Office commute"
                className="w-full px-3 py-2.5 bg-surface-100 border border-border rounded-lg text-sm text-surface-950 placeholder:text-surface-500 focus:outline-none focus:ring-2 focus:ring-teal-400/30 focus:border-teal-400"
              />
            </div>

          </div>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={submitting || !vehicleId}
          className="w-full py-3 bg-teal-500 text-white font-medium rounded-lg hover:bg-teal-400 active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          <MapPin className="w-4 h-4" />
          Record Trip
          {tripMiles ? ` — ${parseFloat(tripMiles).toFixed(1)} mi` : ''}
        </button>
      </form>

      {/* Mileage History */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-surface-900">Trip History</h2>

        {months.length === 0 && (
          <p className="text-sm text-surface-600 text-center py-6">
            No trips recorded yet
          </p>
        )}

        {months.map((month) => {
          const entries = entriesByMonth[month];
          const monthMiles = entries.reduce((sum, e) => sum + (e.tripMiles || 0), 0);
          const isExpanded = activeMonth === month;
          const monthLabel = new Date(month + '-01').toLocaleDateString('en-US', {
            month: 'long',
            year: 'numeric',
          });

          return (
            <div key={month} className="glass-card rounded-xl overflow-hidden">
              <button
                onClick={() => setExpandedMonth(isExpanded ? null : month)}
                className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-surface-100/50 transition-colors"
              >
                <span className="text-sm font-medium text-surface-900">
                  {monthLabel}
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-teal-500 tabular-nums">
                    {monthMiles.toFixed(0)} mi
                  </span>
                  <span className="text-[11px] text-surface-500">
                    ({entries.length})
                  </span>
                  {isExpanded ? (
                    <ChevronUp className="w-4 h-4 text-surface-500" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-surface-500" />
                  )}
                </div>
              </button>

              {isExpanded && (
                <div className="border-t border-border divide-y divide-border/50">
                  {entries.map((entry) => {
                    const vehicle = data.vehicles.find(
                      (v) => v.id === entry.vehicleId,
                    );
                    const mpg =
                      entry.gallons && entry.gallons > 0 && entry.tripMiles
                        ? (entry.tripMiles / entry.gallons).toFixed(1)
                        : null;
                    return (
                      <div
                        key={entry.id}
                        className="flex items-center justify-between px-4 py-2.5 group"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-surface-900 truncate">
                            {entry.tripMiles ? `${entry.tripMiles.toFixed(1)} mi` : 'No miles'}
                            {entry.purpose && (
                              <span className="text-surface-600"> — {entry.purpose}</span>
                            )}
                          </p>
                          <p className="text-[11px] text-surface-600">
                            {vehicle?.name || entry.vehicleId}
                            {entry.gallons ? ` · ${entry.gallons.toFixed(1)} gal` : ''}
                            {entry.totalCost ? ` · $${entry.totalCost.toFixed(2)}` : ''}
                            {mpg ? ` · ${mpg} MPG` : ''}
                            {' · '}
                            {new Date(entry.date + 'T00:00:00').toLocaleDateString(
                              'en-US',
                              { month: 'short', day: 'numeric' },
                            )}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-teal-500 tabular-nums">
                            ${((entry.tripMiles || 0) * data.irsRate).toFixed(2)}
                          </span>
                          <button
                            onClick={() => void handleDelete(entry.id)}
                            className="p-1.5 rounded-lg text-surface-400 hover:text-danger-400 hover:bg-danger-500/10 transition-all md:opacity-0 md:group-hover:opacity-100"
                            title="Delete entry"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
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

      {/* Vehicle Management */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-surface-900 flex items-center gap-2">
            <Car className="w-4 h-4 text-surface-600" />
            Vehicles
          </h2>
          <button
            onClick={() => setShowVehicleForm(!showVehicleForm)}
            className="text-[12px] text-teal-500 hover:text-teal-400 transition-colors"
          >
            {showVehicleForm ? 'Cancel' : '+ Add'}
          </button>
        </div>

        {showVehicleForm && (
          <form
            onSubmit={handleAddVehicle}
            className="glass-card rounded-xl p-3 space-y-2"
          >
            <div className="flex gap-2">
              <input
                type="text"
                value={newVehicleName}
                onChange={(e) => setNewVehicleName(e.target.value)}
                placeholder="Vehicle name"
                required
                className="flex-1 px-3 py-2 bg-surface-100 border border-border rounded-lg text-sm text-surface-950 placeholder:text-surface-500 focus:outline-none focus:ring-2 focus:ring-teal-400/30"
              />
              <input
                type="number"
                value={newVehicleYear}
                onChange={(e) => setNewVehicleYear(e.target.value)}
                placeholder="Year"
                className="w-20 px-3 py-2 bg-surface-100 border border-border rounded-lg text-sm text-surface-950 text-center placeholder:text-surface-500 focus:outline-none focus:ring-2 focus:ring-teal-400/30"
              />
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={newVehicleMake}
                onChange={(e) => setNewVehicleMake(e.target.value)}
                placeholder="Make"
                className="flex-1 px-3 py-2 bg-surface-100 border border-border rounded-lg text-sm text-surface-950 placeholder:text-surface-500 focus:outline-none focus:ring-2 focus:ring-teal-400/30"
              />
              <input
                type="text"
                value={newVehicleModel}
                onChange={(e) => setNewVehicleModel(e.target.value)}
                placeholder="Model"
                className="flex-1 px-3 py-2 bg-surface-100 border border-border rounded-lg text-sm text-surface-950 placeholder:text-surface-500 focus:outline-none focus:ring-2 focus:ring-teal-400/30"
              />
              <button
                type="submit"
                className="px-3 py-2 bg-teal-500 text-white rounded-lg hover:bg-teal-400 active:scale-[0.98] transition-all text-sm"
              >
                Add
              </button>
            </div>
          </form>
        )}

        <div className="glass-card rounded-xl divide-y divide-border/50 overflow-hidden">
          {data.vehicles.length === 0 && (
            <p className="text-sm text-surface-600 text-center py-4">
              No vehicles added yet
            </p>
          )}
          {data.vehicles.map((vehicle) => (
            <div
              key={vehicle.id}
              className="flex items-center justify-between px-4 py-2.5 group"
            >
              <div>
                <span className="text-sm text-surface-900">{vehicle.name}</span>
                {(vehicle.year || vehicle.make || vehicle.model) && (
                  <span className="text-[11px] text-surface-600 ml-2">
                    {[vehicle.year, vehicle.make, vehicle.model]
                      .filter(Boolean)
                      .join(' ')}
                  </span>
                )}
              </div>
              <button
                onClick={() => void handleDeleteVehicle(vehicle.id)}
                className="p-1.5 rounded-lg text-surface-400 hover:text-danger-400 hover:bg-danger-500/10 opacity-0 group-hover:opacity-100 transition-all"
                title="Delete vehicle"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
