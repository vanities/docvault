import { useState, useEffect, useCallback } from 'react';
import { Egg, Plus, Trash2, DollarSign, ChevronDown, ChevronUp, Package } from 'lucide-react';
import type { Sale, SaleProduct, SalesData } from '../../types';
import { useAppContext } from '../../contexts/AppContext';

const API = '/api/sales';

export function SalesView() {
  const { selectedEntity, entities } = useAppContext();
  const [data, setData] = useState<SalesData>({ products: [], sales: [] });
  const [loading, setLoading] = useState(true);

  // Form state
  const [person, setPerson] = useState('');
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [submitting, setSubmitting] = useState(false);

  // UI state
  const [showProductForm, setShowProductForm] = useState(false);
  const [newProductName, setNewProductName] = useState('');
  const [newProductPrice, setNewProductPrice] = useState('');
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);

  // Known customers from past sales (autocomplete)
  const knownCustomers = [...new Set(data.sales.map((s) => s.person))].sort();

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(API);
      const json = await res.json();
      setData(json);
      if (!productId && json.products.length > 0) {
        setProductId(json.products[0].id);
      }
    } catch (err) {
      console.error('Failed to load sales:', err);
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const selectedProduct = data.products.find((p) => p.id === productId);
  const lineTotal = selectedProduct ? selectedProduct.price * quantity : 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!person.trim() || !productId) return;

    setSubmitting(true);
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          person: person.trim(),
          productId,
          quantity,
          date,
          entity: selectedEntity !== 'all' ? selectedEntity : undefined,
        }),
      });
      if (res.ok) {
        setPerson('');
        setQuantity(1);
        setDate(new Date().toISOString().split('T')[0]);
        await fetchData();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (saleId: string) => {
    await fetch(`${API}/${saleId}`, { method: 'DELETE' });
    await fetchData();
  };

  const handleAddProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProductName.trim() || !newProductPrice) return;

    await fetch(`${API}/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: newProductName.trim(),
        price: parseFloat(newProductPrice),
      }),
    });
    setNewProductName('');
    setNewProductPrice('');
    setShowProductForm(false);
    await fetchData();
  };

  const handleDeleteProduct = async (id: string) => {
    await fetch(`${API}/products/${id}`, { method: 'DELETE' });
    await fetchData();
  };

  // Filter sales by selected entity
  const filteredSales =
    selectedEntity === 'all' ? data.sales : data.sales.filter((s) => s.entity === selectedEntity);

  // Group sales by month (most recent first)
  const salesByMonth = filteredSales
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date))
    .reduce<Record<string, Sale[]>>((acc, sale) => {
      const month = sale.date.substring(0, 7); // YYYY-MM
      if (!acc[month]) acc[month] = [];
      acc[month].push(sale);
      return acc;
    }, {});

  const months = Object.keys(salesByMonth).sort((a, b) => b.localeCompare(a));

  // Auto-expand current month
  const currentMonth = new Date().toISOString().substring(0, 7);
  const activeMonth = expandedMonth ?? currentMonth;

  // Totals
  const allTimeSales = filteredSales.reduce((sum, s) => sum + s.total, 0);
  const currentMonthSales = (salesByMonth[currentMonth] || []).reduce((sum, s) => sum + s.total, 0);

  const entityName = entities.find((e) => e.id === selectedEntity)?.name;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-6 h-6 border-2 border-accent-400 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2.5 bg-amber-500/10 rounded-xl">
          <Egg className="w-6 h-6 text-amber-500" />
        </div>
        <div>
          <h1 className="font-display text-xl text-surface-950">Sales Tracker</h1>
          <p className="text-[12px] text-surface-600">
            {entityName || (selectedEntity === 'all' ? 'All Entities' : selectedEntity)}
          </p>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 gap-3">
        <div className="glass-card rounded-xl p-3">
          <p className="text-[11px] text-surface-600 uppercase tracking-wider">This Month</p>
          <p className="text-xl font-semibold text-surface-950 tabular-nums">
            ${currentMonthSales.toFixed(2)}
          </p>
        </div>
        <div className="glass-card rounded-xl p-3">
          <p className="text-[11px] text-surface-600 uppercase tracking-wider">All Time</p>
          <p className="text-xl font-semibold text-surface-950 tabular-nums">
            ${allTimeSales.toFixed(2)}
          </p>
        </div>
      </div>

      {/* Quick Entry Form */}
      <form onSubmit={handleSubmit} className="glass-card rounded-xl p-4 space-y-3">
        <h2 className="text-sm font-semibold text-surface-900 flex items-center gap-2">
          <Plus className="w-4 h-4 text-accent-400" />
          New Sale
        </h2>

        {/* Customer */}
        <div>
          <label className="text-[11px] text-surface-600 uppercase tracking-wider block mb-1">
            Customer
          </label>
          <input
            type="text"
            value={person}
            onChange={(e) => setPerson(e.target.value)}
            placeholder="Name"
            list="known-customers"
            required
            autoComplete="off"
            className="w-full px-3 py-2.5 bg-surface-100 border border-border rounded-lg text-sm text-surface-950 placeholder:text-surface-500 focus:outline-none focus:ring-2 focus:ring-accent-400/30 focus:border-accent-400"
          />
          <datalist id="known-customers">
            {knownCustomers.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>

        {/* Product + Quantity row */}
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="text-[11px] text-surface-600 uppercase tracking-wider block mb-1">
              Product
            </label>
            <select
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              className="w-full px-3 py-2.5 bg-surface-100 border border-border rounded-lg text-sm text-surface-950 focus:outline-none focus:ring-2 focus:ring-accent-400/30 focus:border-accent-400"
            >
              {data.products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — ${p.price}
                </option>
              ))}
            </select>
          </div>
          <div className="w-20">
            <label className="text-[11px] text-surface-600 uppercase tracking-wider block mb-1">
              Qty
            </label>
            <input
              type="number"
              min={1}
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-full px-3 py-2.5 bg-surface-100 border border-border rounded-lg text-sm text-surface-950 text-center focus:outline-none focus:ring-2 focus:ring-accent-400/30 focus:border-accent-400"
            />
          </div>
        </div>

        {/* Date */}
        <div>
          <label className="text-[11px] text-surface-600 uppercase tracking-wider block mb-1">
            Date
          </label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full px-3 py-2.5 bg-surface-100 border border-border rounded-lg text-sm text-surface-950 focus:outline-none focus:ring-2 focus:ring-accent-400/30 focus:border-accent-400"
          />
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={submitting || !person.trim() || !productId}
          className="w-full py-3 bg-accent-500 text-white font-medium rounded-lg hover:bg-accent-400 active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          <DollarSign className="w-4 h-4" />
          Record Sale — ${lineTotal.toFixed(2)}
        </button>
      </form>

      {/* Sales History */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-surface-900">Sales History</h2>

        {months.length === 0 && (
          <p className="text-sm text-surface-600 text-center py-6">No sales recorded yet</p>
        )}

        {months.map((month) => {
          const sales = salesByMonth[month];
          const monthTotal = sales.reduce((sum, s) => sum + s.total, 0);
          const isExpanded = activeMonth === month;
          const monthLabel = new Date(month + '-01T00:00:00').toLocaleDateString('en-US', {
            month: 'long',
            year: 'numeric',
          });

          return (
            <div key={month} className="glass-card rounded-xl overflow-hidden">
              <button
                onClick={() => setExpandedMonth(isExpanded ? null : month)}
                className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-surface-100/50 transition-colors"
              >
                <span className="text-sm font-medium text-surface-900">{monthLabel}</span>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-accent-400 tabular-nums">
                    ${monthTotal.toFixed(2)}
                  </span>
                  <span className="text-[11px] text-surface-500">({sales.length})</span>
                  {isExpanded ? (
                    <ChevronUp className="w-4 h-4 text-surface-500" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-surface-500" />
                  )}
                </div>
              </button>

              {isExpanded && (
                <div className="border-t border-border divide-y divide-border/50">
                  {sales.map((sale) => {
                    const product = data.products.find((p) => p.id === sale.productId);
                    return (
                      <div
                        key={sale.id}
                        className="flex items-center justify-between px-4 py-2.5 group"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-surface-900 truncate">{sale.person}</p>
                          <p className="text-[11px] text-surface-600">
                            {product?.name || sale.productId}
                            {sale.quantity > 1 && ` x${sale.quantity}`}
                            {' · '}
                            {new Date(sale.date + 'T00:00:00').toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                            })}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-surface-950 tabular-nums">
                            ${sale.total.toFixed(2)}
                          </span>
                          <button
                            onClick={() => void handleDelete(sale.id)}
                            className="p-1.5 rounded-lg text-surface-400 hover:text-danger-400 hover:bg-danger-500/10 transition-all md:opacity-0 md:group-hover:opacity-100"
                            title="Delete sale"
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

      {/* Products Management */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-surface-900 flex items-center gap-2">
            <Package className="w-4 h-4 text-surface-600" />
            Products
          </h2>
          <button
            onClick={() => setShowProductForm(!showProductForm)}
            className="text-[12px] text-accent-400 hover:text-accent-300 transition-colors"
          >
            {showProductForm ? 'Cancel' : '+ Add'}
          </button>
        </div>

        {showProductForm && (
          <form onSubmit={handleAddProduct} className="glass-card rounded-xl p-3 flex gap-2">
            <input
              type="text"
              value={newProductName}
              onChange={(e) => setNewProductName(e.target.value)}
              placeholder="Product name"
              required
              className="flex-1 px-3 py-2 bg-surface-100 border border-border rounded-lg text-sm text-surface-950 placeholder:text-surface-500 focus:outline-none focus:ring-2 focus:ring-accent-400/30"
            />
            <input
              type="number"
              step="0.01"
              min="0"
              value={newProductPrice}
              onChange={(e) => setNewProductPrice(e.target.value)}
              placeholder="$"
              required
              className="w-20 px-3 py-2 bg-surface-100 border border-border rounded-lg text-sm text-surface-950 text-center placeholder:text-surface-500 focus:outline-none focus:ring-2 focus:ring-accent-400/30"
            />
            <button
              type="submit"
              className="px-3 py-2 bg-accent-500 text-white rounded-lg hover:bg-accent-400 active:scale-[0.98] transition-all text-sm"
            >
              Add
            </button>
          </form>
        )}

        <div className="glass-card rounded-xl divide-y divide-border/50 overflow-hidden">
          {data.products.map((product) => (
            <div key={product.id} className="flex items-center justify-between px-4 py-2.5 group">
              <span className="text-sm text-surface-900">{product.name}</span>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-surface-950 tabular-nums">
                  ${product.price.toFixed(2)}
                </span>
                <button
                  onClick={() => void handleDeleteProduct(product.id)}
                  className="p-1.5 rounded-lg text-surface-400 hover:text-danger-400 hover:bg-danger-500/10 opacity-0 group-hover:opacity-100 transition-all"
                  title="Delete product"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
