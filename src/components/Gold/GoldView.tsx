import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Coins,
  Plus,
  Trash2,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  ChevronDown,
  ChevronUp,
  Edit3,
} from 'lucide-react';
import type { GoldEntry, GoldData, MetalType, CoinSize } from '../../types';

const API = '/api/gold';

// =============================================================================
// Gold Product Presets
// =============================================================================

interface GoldProduct {
  id: string;
  label: string;
  metal: MetalType;
  purity: number;
  availableSizes: CoinSize[];
  defaultSize: CoinSize;
}

const GOLD_PRODUCTS: GoldProduct[] = [
  {
    id: 'american-eagle',
    label: 'American Gold Eagle',
    metal: 'gold',
    purity: 0.9167, // 22K
    availableSizes: ['1oz', '1/2oz', '1/4oz', '1/10oz'],
    defaultSize: '1oz',
  },
  {
    id: 'american-buffalo',
    label: 'American Gold Buffalo',
    metal: 'gold',
    purity: 0.9999, // 24K
    availableSizes: ['1oz'],
    defaultSize: '1oz',
  },
  {
    id: 'canadian-maple-leaf',
    label: 'Canadian Gold Maple Leaf',
    metal: 'gold',
    purity: 0.9999,
    availableSizes: ['1oz', '1/2oz', '1/4oz', '1/10oz'],
    defaultSize: '1oz',
  },
  {
    id: 'south-african-krugerrand',
    label: 'South African Krugerrand',
    metal: 'gold',
    purity: 0.9167,
    availableSizes: ['1oz', '1/2oz', '1/4oz', '1/10oz'],
    defaultSize: '1oz',
  },
  {
    id: 'austrian-philharmonic',
    label: 'Austrian Gold Philharmonic',
    metal: 'gold',
    purity: 0.9999,
    availableSizes: ['1oz', '1/2oz', '1/4oz', '1/10oz'],
    defaultSize: '1oz',
  },
  {
    id: 'chinese-panda',
    label: 'Chinese Gold Panda',
    metal: 'gold',
    purity: 0.999,
    availableSizes: ['1oz', '1/2oz', '1/4oz', '1/10oz'],
    defaultSize: '1oz',
  },
  {
    id: 'british-britannia',
    label: 'British Gold Britannia',
    metal: 'gold',
    purity: 0.9999,
    availableSizes: ['1oz', '1/2oz', '1/4oz', '1/10oz'],
    defaultSize: '1oz',
  },
  {
    id: 'gold-bar',
    label: 'Gold Bar',
    metal: 'gold',
    purity: 0.9999,
    availableSizes: ['1oz', '1/2oz', '1/4oz', '1/10oz'],
    defaultSize: '1oz',
  },
  {
    id: 'american-silver-eagle',
    label: 'American Silver Eagle',
    metal: 'silver',
    purity: 0.999,
    availableSizes: ['1oz'],
    defaultSize: '1oz',
  },
  {
    id: 'silver-bar',
    label: 'Silver Bar',
    metal: 'silver',
    purity: 0.999,
    availableSizes: ['1oz'],
    defaultSize: '1oz',
  },
  {
    id: 'american-platinum-eagle',
    label: 'American Platinum Eagle',
    metal: 'platinum',
    purity: 0.9995,
    availableSizes: ['1oz', '1/2oz', '1/4oz', '1/10oz'],
    defaultSize: '1oz',
  },
  {
    id: 'custom',
    label: 'Custom / Other',
    metal: 'gold',
    purity: 0.999,
    availableSizes: ['1oz', '1/2oz', '1/4oz', '1/10oz'],
    defaultSize: '1oz',
  },
];

const SIZE_WEIGHTS: Record<CoinSize, number> = {
  '1oz': 1.0,
  '1/2oz': 0.5,
  '1/4oz': 0.25,
  '1/10oz': 0.1,
};

const SIZE_LABELS: Record<CoinSize, string> = {
  '1oz': '1 oz',
  '1/2oz': '1/2 oz',
  '1/4oz': '1/4 oz',
  '1/10oz': '1/10 oz',
};

const KNOWN_DEALERS = [
  'APMEX',
  'JM Bullion',
  'SD Bullion',
  'Monument Metals',
  'Hero Bullion',
  'Costco',
  'US Mint',
  'Local Dealer',
];

function formatUsd(value: number): string {
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  });
}

function getMetalColor(metal: MetalType): string {
  switch (metal) {
    case 'gold':
      return 'text-yellow-500';
    case 'silver':
      return 'text-slate-400';
    case 'platinum':
      return 'text-blue-300';
    case 'palladium':
      return 'text-purple-400';
  }
}

function getMetalBgColor(metal: MetalType): string {
  switch (metal) {
    case 'gold':
      return 'bg-yellow-500/10';
    case 'silver':
      return 'bg-slate-400/10';
    case 'platinum':
      return 'bg-blue-300/10';
    case 'palladium':
      return 'bg-purple-400/10';
  }
}

// =============================================================================
// Component
// =============================================================================

export function GoldView() {
  const [data, setData] = useState<GoldData>({ entries: [] });
  const [spotPrices, setSpotPrices] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Form state
  const [productId, setProductId] = useState('american-eagle');
  const [customDescription, setCustomDescription] = useState('');
  const [coinYear, setCoinYear] = useState('');
  const [size, setSize] = useState<CoinSize>('1oz');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [dealer, setDealer] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const selectedProduct = GOLD_PRODUCTS.find((p) => p.id === productId) || GOLD_PRODUCTS[0];

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(API);
      const json = await res.json();
      setData({ entries: json.entries || [] });
      if (json.spotPrices) setSpotPrices(json.spotPrices);
    } catch (err) {
      console.error('Failed to load gold data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const refreshSpot = async () => {
    setRefreshing(true);
    try {
      const res = await fetch(`${API}/spot`);
      if (res.ok) {
        const prices = await res.json();
        setSpotPrices(prices);
      }
    } catch {
      // Non-critical
    } finally {
      setRefreshing(false);
    }
  };

  // When product changes, update size and metal
  const handleProductChange = (newProductId: string) => {
    setProductId(newProductId);
    const product = GOLD_PRODUCTS.find((p) => p.id === newProductId);
    if (product) {
      setSize(product.defaultSize);
    }
  };

  const resetForm = () => {
    setProductId('american-eagle');
    setCustomDescription('');
    setCoinYear('');
    setSize('1oz');
    setPurchasePrice('');
    setPurchaseDate(new Date().toISOString().split('T')[0]);
    setDealer('');
    setQuantity(1);
    setNotes('');
    setEditingId(null);
  };

  const populateForm = (entry: GoldEntry) => {
    setProductId(entry.productId);
    setCustomDescription(entry.customDescription || '');
    setCoinYear(entry.coinYear?.toString() || '');
    setSize(entry.size);
    setPurchasePrice(entry.purchasePrice.toString());
    setPurchaseDate(entry.purchaseDate);
    setDealer(entry.dealer || '');
    setQuantity(entry.quantity);
    setNotes(entry.notes || '');
    setEditingId(entry.id);
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!purchasePrice || !purchaseDate) return;

    setSubmitting(true);
    try {
      const weightOz = SIZE_WEIGHTS[size];
      const body = {
        metal: selectedProduct.metal,
        productId,
        customDescription: productId === 'custom' ? customDescription : undefined,
        coinYear: coinYear ? Number(coinYear) : undefined,
        size,
        weightOz,
        purity: selectedProduct.purity,
        purchasePrice: Number(purchasePrice),
        purchaseDate,
        dealer: dealer || undefined,
        quantity,
        notes: notes || undefined,
      };

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
      console.error('Failed to add gold entry:', err);
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
      console.error('Failed to delete gold entry:', err);
    }
  };

  // Compute totals
  const summary = useMemo(() => {
    let totalPurchaseValue = 0;
    let totalCurrentValue = 0;
    let totalPureOz = 0;
    const byMetal: Record<string, { pureOz: number; cost: number; value: number; count: number }> =
      {};

    for (const entry of data.entries) {
      // For standard coins/bars, size denomination = pure metal content (e.g. "1 oz Eagle" = 1 oz pure gold)
      const pureOz = entry.weightOz * entry.quantity;
      const cost = entry.purchasePrice * entry.quantity;
      const spotPrice = spotPrices[entry.metal] || 0;
      const currentValue = pureOz * spotPrice;

      totalPurchaseValue += cost;
      totalCurrentValue += currentValue;
      totalPureOz += pureOz;

      if (!byMetal[entry.metal]) {
        byMetal[entry.metal] = { pureOz: 0, cost: 0, value: 0, count: 0 };
      }
      byMetal[entry.metal].pureOz += pureOz;
      byMetal[entry.metal].cost += cost;
      byMetal[entry.metal].value += currentValue;
      byMetal[entry.metal].count += entry.quantity;
    }

    return {
      totalPurchaseValue,
      totalCurrentValue,
      totalGainLoss: totalCurrentValue - totalPurchaseValue,
      totalPureOz,
      byMetal,
    };
  }, [data.entries, spotPrices]);

  const gainPercent =
    summary.totalPurchaseValue > 0
      ? ((summary.totalGainLoss / summary.totalPurchaseValue) * 100).toFixed(1)
      : '0.0';
  const isGain = summary.totalGainLoss >= 0;

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
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-yellow-500/10 rounded-xl">
            <Coins className="w-6 h-6 text-yellow-500" />
          </div>
          <div>
            <h1 className="font-display text-xl text-surface-950">Precious Metals</h1>
            <p className="text-sm text-surface-600">Track physical gold, silver &amp; platinum</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={refreshSpot}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-surface-700 bg-surface-100 hover:bg-surface-200 rounded-lg transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Spot Prices
          </button>
          <button
            onClick={() => {
              resetForm();
              setShowForm(!showForm);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-surface-0 bg-yellow-600 hover:bg-yellow-500 rounded-lg transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Entry
          </button>
        </div>
      </div>

      {/* Spot Price Banner */}
      {Object.keys(spotPrices).length > 0 && (
        <div className="glass-card rounded-xl p-4">
          <h3 className="text-xs font-semibold text-surface-600 uppercase tracking-wider mb-3">
            Live Spot Prices (per troy oz)
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {(['gold', 'silver', 'platinum', 'palladium'] as MetalType[]).map(
              (metal) =>
                spotPrices[metal] && (
                  <div key={metal} className={`p-3 rounded-lg ${getMetalBgColor(metal)}`}>
                    <span
                      className={`text-xs font-medium uppercase tracking-wide ${getMetalColor(metal)}`}
                    >
                      {metal}
                    </span>
                    <p className="text-lg font-semibold text-surface-950 mt-0.5">
                      {formatUsd(spotPrices[metal])}
                    </p>
                  </div>
                )
            )}
          </div>
        </div>
      )}

      {/* Summary Cards */}
      {data.entries.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="glass-card rounded-xl p-4">
            <span className="text-xs text-surface-600">Current Value</span>
            <p className="text-lg font-semibold text-surface-950">
              {formatUsd(summary.totalCurrentValue)}
            </p>
          </div>
          <div className="glass-card rounded-xl p-4">
            <span className="text-xs text-surface-600">Total Cost</span>
            <p className="text-lg font-semibold text-surface-950">
              {formatUsd(summary.totalPurchaseValue)}
            </p>
          </div>
          <div className="glass-card rounded-xl p-4">
            <span className="text-xs text-surface-600">Gain/Loss</span>
            <p
              className={`text-lg font-semibold flex items-center gap-1 ${isGain ? 'text-accent-500' : 'text-danger-500'}`}
            >
              {isGain ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
              {formatUsd(Math.abs(summary.totalGainLoss))}
              <span className="text-xs font-normal">({gainPercent}%)</span>
            </p>
          </div>
          <div className="glass-card rounded-xl p-4">
            <span className="text-xs text-surface-600">Total Pure oz</span>
            <p className="text-lg font-semibold text-surface-950">
              {summary.totalPureOz.toFixed(4)}
            </p>
          </div>
        </div>
      )}

      {/* By Metal Breakdown */}
      {Object.keys(summary.byMetal).length > 1 && (
        <div className="glass-card rounded-xl p-4">
          <h3 className="text-xs font-semibold text-surface-600 uppercase tracking-wider mb-3">
            By Metal
          </h3>
          <div className="space-y-2">
            {Object.entries(summary.byMetal).map(([metal, stats]) => {
              const metalGain = stats.value - stats.cost;
              const metalGainPct =
                stats.cost > 0 ? ((metalGain / stats.cost) * 100).toFixed(1) : '0.0';
              return (
                <div
                  key={metal}
                  className="flex items-center justify-between p-2.5 rounded-lg bg-surface-100/50"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-sm font-medium capitalize ${getMetalColor(metal as MetalType)}`}
                    >
                      {metal}
                    </span>
                    <span className="text-xs text-surface-500">
                      {stats.count} pcs · {stats.pureOz.toFixed(4)} pure oz
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-sm font-semibold text-surface-950">
                      {formatUsd(stats.value)}
                    </span>
                    <span
                      className={`text-xs ml-2 ${metalGain >= 0 ? 'text-accent-500' : 'text-danger-500'}`}
                    >
                      {metalGain >= 0 ? '+' : ''}
                      {metalGainPct}%
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Add Entry Form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="glass-card rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-semibold text-surface-950">
            {editingId ? 'Edit Entry' : 'Add New Entry'}
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Product Dropdown */}
            <div>
              <label className="block text-xs font-medium text-surface-600 mb-1">Product</label>
              <select
                value={productId}
                onChange={(e) => handleProductChange(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-surface-100 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-500/40"
              >
                <optgroup label="Gold Coins">
                  {GOLD_PRODUCTS.filter(
                    (p) => p.metal === 'gold' && p.id !== 'gold-bar' && p.id !== 'custom'
                  ).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Gold Bars">
                  {GOLD_PRODUCTS.filter((p) => p.id === 'gold-bar').map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Silver">
                  {GOLD_PRODUCTS.filter((p) => p.metal === 'silver').map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Platinum">
                  {GOLD_PRODUCTS.filter((p) => p.metal === 'platinum').map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Other">
                  <option value="custom">Custom / Other</option>
                </optgroup>
              </select>
            </div>

            {/* Custom description (only if custom) */}
            {productId === 'custom' && (
              <div>
                <label className="block text-xs font-medium text-surface-600 mb-1">
                  Description
                </label>
                <input
                  type="text"
                  value={customDescription}
                  onChange={(e) => setCustomDescription(e.target.value)}
                  placeholder="e.g., 1 oz Generic Gold Round"
                  className="w-full px-3 py-2 text-sm bg-surface-100 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-500/40"
                />
              </div>
            )}

            {/* Size Dropdown */}
            <div>
              <label className="block text-xs font-medium text-surface-600 mb-1">Size</label>
              <select
                value={size}
                onChange={(e) => setSize(e.target.value as CoinSize)}
                className="w-full px-3 py-2 text-sm bg-surface-100 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-500/40"
              >
                {selectedProduct.availableSizes.map((s) => (
                  <option key={s} value={s}>
                    {SIZE_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>

            {/* Coin Year */}
            <div>
              <label className="block text-xs font-medium text-surface-600 mb-1">
                Coin Year <span className="text-surface-500">(optional)</span>
              </label>
              <input
                type="number"
                value={coinYear}
                onChange={(e) => setCoinYear(e.target.value)}
                placeholder={`${new Date().getFullYear()}`}
                min={1800}
                max={new Date().getFullYear() + 1}
                className="w-full px-3 py-2 text-sm bg-surface-100 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-500/40"
              />
            </div>

            {/* Quantity */}
            <div>
              <label className="block text-xs font-medium text-surface-600 mb-1">Quantity</label>
              <input
                type="number"
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))}
                min={1}
                className="w-full px-3 py-2 text-sm bg-surface-100 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-500/40"
              />
            </div>

            {/* Purchase Price (per piece) */}
            <div>
              <label className="block text-xs font-medium text-surface-600 mb-1">
                Price Paid (per piece)
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-surface-500">
                  $
                </span>
                <input
                  type="number"
                  value={purchasePrice}
                  onChange={(e) => setPurchasePrice(e.target.value)}
                  placeholder="0.00"
                  step="0.01"
                  min="0"
                  required
                  className="w-full pl-7 pr-3 py-2 text-sm bg-surface-100 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-500/40"
                />
              </div>
            </div>

            {/* Purchase Date */}
            <div>
              <label className="block text-xs font-medium text-surface-600 mb-1">Date Bought</label>
              <input
                type="date"
                value={purchaseDate}
                onChange={(e) => setPurchaseDate(e.target.value)}
                required
                className="w-full px-3 py-2 text-sm bg-surface-100 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-500/40"
              />
            </div>

            {/* Dealer */}
            <div>
              <label className="block text-xs font-medium text-surface-600 mb-1">
                Dealer <span className="text-surface-500">(optional)</span>
              </label>
              <input
                type="text"
                value={dealer}
                onChange={(e) => setDealer(e.target.value)}
                list="dealer-suggestions"
                placeholder="e.g., APMEX"
                className="w-full px-3 py-2 text-sm bg-surface-100 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-500/40"
              />
              <datalist id="dealer-suggestions">
                {KNOWN_DEALERS.map((d) => (
                  <option key={d} value={d} />
                ))}
              </datalist>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-medium text-surface-600 mb-1">
              Notes <span className="text-surface-500">(optional)</span>
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Serial number, condition, etc."
              className="w-full px-3 py-2 text-sm bg-surface-100 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-500/40"
            />
          </div>

          {/* Purity info */}
          <p className="text-xs text-surface-500">
            Purity: {(selectedProduct.purity * 100).toFixed(2)}% · Size: {SIZE_LABELS[size]} pure{' '}
            {selectedProduct.metal}
            {quantity > 1 && <> · Total: {formatUsd(Number(purchasePrice || 0) * quantity)}</>}
          </p>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                resetForm();
              }}
              className="px-4 py-2 text-sm text-surface-600 hover:text-surface-900 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !purchasePrice}
              className="px-4 py-2 text-sm font-medium text-surface-0 bg-yellow-600 hover:bg-yellow-500 rounded-lg transition-colors disabled:opacity-50"
            >
              {submitting ? 'Saving...' : editingId ? 'Update Entry' : 'Add Entry'}
            </button>
          </div>
        </form>
      )}

      {/* Entries List */}
      {data.entries.length === 0 ? (
        <div className="glass-card rounded-xl p-10 text-center">
          <Coins className="w-10 h-10 text-yellow-500/40 mx-auto mb-3" />
          <p className="text-surface-600 text-sm">No precious metals entries yet.</p>
          <p className="text-surface-500 text-xs mt-1">
            Click "Add Entry" to start tracking your physical gold.
          </p>
        </div>
      ) : (
        <EntriesList
          entries={data.entries}
          spotPrices={spotPrices}
          onDelete={handleDelete}
          onEdit={populateForm}
        />
      )}
    </div>
  );
}

// =============================================================================
// Entries List Sub-component
// =============================================================================

function EntriesList({
  entries,
  spotPrices,
  onDelete,
  onEdit,
}: {
  entries: GoldEntry[];
  spotPrices: Record<string, number>;
  onDelete: (id: string) => void;
  onEdit: (entry: GoldEntry) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  // Sort by purchase date descending
  const sorted = useMemo(
    () => [...entries].sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate)),
    [entries]
  );

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold text-surface-600 uppercase tracking-wider px-1">
        Holdings ({entries.length} {entries.length === 1 ? 'entry' : 'entries'})
      </h3>
      {sorted.map((entry) => {
        const product = GOLD_PRODUCTS.find((p) => p.id === entry.productId);
        const label =
          entry.productId === 'custom'
            ? entry.customDescription || 'Custom'
            : product?.label || entry.productId;
        const pureOz = entry.weightOz * entry.quantity;
        const spotPrice = spotPrices[entry.metal] || 0;
        const currentValue = pureOz * spotPrice;
        const totalCost = entry.purchasePrice * entry.quantity;
        const gainLoss = currentValue - totalCost;
        const gainPct = totalCost > 0 ? ((gainLoss / totalCost) * 100).toFixed(1) : '0.0';
        const isExpanded = expanded === entry.id;

        return (
          <div key={entry.id} className="glass-card rounded-xl overflow-hidden">
            <button
              onClick={() => setExpanded(isExpanded ? null : entry.id)}
              className="w-full flex items-center justify-between p-4 text-left hover:bg-surface-100/50 transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className={`p-2 rounded-lg ${getMetalBgColor(entry.metal)}`}>
                  <Coins className={`w-4 h-4 ${getMetalColor(entry.metal)}`} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-surface-950 truncate">
                    {entry.quantity > 1 && `${entry.quantity}x `}
                    {label}
                    {entry.coinYear && ` (${entry.coinYear})`}
                  </p>
                  <p className="text-xs text-surface-500">
                    {SIZE_LABELS[entry.size]} · Paid {formatUsd(entry.purchasePrice)}
                    {entry.quantity > 1 &&
                      `/ea (${formatUsd(entry.purchasePrice * entry.quantity)} total)`}
                    {' · '}
                    {entry.purchaseDate}
                    {entry.dealer && ` · ${entry.dealer}`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <p className="text-sm font-semibold text-surface-950">
                    {spotPrice > 0 ? formatUsd(currentValue) : formatUsd(totalCost)}
                  </p>
                  {spotPrice > 0 && (
                    <p
                      className={`text-xs ${gainLoss >= 0 ? 'text-accent-500' : 'text-danger-500'}`}
                    >
                      {gainLoss >= 0 ? '+' : ''}
                      {gainPct}%
                    </p>
                  )}
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
                    <span className="text-surface-500">Metal</span>
                    <p className={`font-medium capitalize ${getMetalColor(entry.metal)}`}>
                      {entry.metal}
                    </p>
                  </div>
                  <div>
                    <span className="text-surface-500">Purity</span>
                    <p className="font-medium text-surface-900">
                      {(entry.purity * 100).toFixed(2)}%
                    </p>
                  </div>
                  <div>
                    <span className="text-surface-500">Pure Content</span>
                    <p className="font-medium text-surface-900">{pureOz.toFixed(4)} oz</p>
                  </div>
                  <div>
                    <span className="text-surface-500">Cost per Piece</span>
                    <p className="font-medium text-surface-900">{formatUsd(entry.purchasePrice)}</p>
                  </div>
                  <div>
                    <span className="text-surface-500">Total Cost</span>
                    <p className="font-medium text-surface-900">{formatUsd(totalCost)}</p>
                  </div>
                  <div>
                    <span className="text-surface-500">Current Value</span>
                    <p className="font-medium text-surface-900">
                      {spotPrice > 0 ? formatUsd(currentValue) : 'N/A'}
                    </p>
                  </div>
                  <div>
                    <span className="text-surface-500">Gain/Loss</span>
                    <p
                      className={`font-medium ${gainLoss >= 0 ? 'text-accent-500' : 'text-danger-500'}`}
                    >
                      {spotPrice > 0 ? `${gainLoss >= 0 ? '+' : ''}${formatUsd(gainLoss)}` : 'N/A'}
                    </p>
                  </div>
                  <div>
                    <span className="text-surface-500">Spot Price</span>
                    <p className="font-medium text-surface-900">
                      {spotPrice > 0 ? formatUsd(spotPrice) : 'N/A'}
                    </p>
                  </div>
                </div>
                {entry.notes && (
                  <p className="text-xs text-surface-500 mt-2 italic">{entry.notes}</p>
                )}
                <div className="mt-3 flex justify-end gap-2">
                  <button
                    onClick={() => onEdit(entry)}
                    className="flex items-center gap-1 px-2.5 py-1 text-xs text-surface-600 hover:bg-surface-200/50 rounded-lg transition-colors"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    Edit
                  </button>
                  <button
                    onClick={() => onDelete(entry.id)}
                    className="flex items-center gap-1 px-2.5 py-1 text-xs text-danger-500 hover:bg-danger-500/10 rounded-lg transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
