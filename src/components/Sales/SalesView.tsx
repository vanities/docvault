import { useState, useEffect, useCallback } from 'react';
import {
  Egg,
  Plus,
  Trash2,
  DollarSign,
  ChevronDown,
  ChevronUp,
  Package,
  Pencil,
  Check,
  X,
} from 'lucide-react';
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

  // Edit state
  const [editingSaleId, setEditingSaleId] = useState<string | null>(null);
  const [editPerson, setEditPerson] = useState('');
  const [editProductId, setEditProductId] = useState('');
  const [editQuantity, setEditQuantity] = useState(1);
  const [editDate, setEditDate] = useState('');
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [editProductName, setEditProductName] = useState('');
  const [editProductPrice, setEditProductPrice] = useState('');

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

  const startEditSale = (sale: Sale) => {
    setEditingSaleId(sale.id);
    setEditPerson(sale.person);
    setEditProductId(sale.productId);
    setEditQuantity(sale.quantity);
    setEditDate(sale.date);
  };

  const cancelEditSale = () => {
    setEditingSaleId(null);
  };

  const handleUpdateSale = async (saleId: string) => {
    await fetch(`${API}/${saleId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        person: editPerson.trim(),
        productId: editProductId,
        quantity: editQuantity,
        date: editDate,
      }),
    });
    setEditingSaleId(null);
    await fetchData();
  };

  const startEditProduct = (product: SaleProduct) => {
    setEditingProductId(product.id);
    setEditProductName(product.name);
    setEditProductPrice(String(product.price));
  };

  const cancelEditProduct = () => {
    setEditingProductId(null);
  };

  const handleUpdateProduct = async (productId: string) => {
    await fetch(`${API}/products/${productId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: editProductName.trim(),
        price: parseFloat(editProductPrice),
      }),
    });
    setEditingProductId(null);
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
      const month = sale.date.substring(0, 7);
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
  const currentMonthCount = (salesByMonth[currentMonth] || []).length;

  const entityName = entities.find((e) => e.id === selectedEntity)?.name;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-6 h-6 border-2 border-amber-400 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-6 space-y-5 overflow-x-hidden">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2.5 bg-amber-500/10 rounded-xl">
          <Egg className="w-6 h-6 text-amber-500" />
        </div>
        <div className="min-w-0">
          <h1 className="font-display text-xl text-surface-950">Sales Tracker</h1>
          <p className="text-[12px] text-surface-600 truncate">
            {entityName || (selectedEntity === 'all' ? 'All Entities' : selectedEntity)}
          </p>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 gap-3">
        <div className="glass-card rounded-xl p-4">
          <p className="text-[11px] text-surface-500 uppercase tracking-wider font-medium">
            This Month
          </p>
          <p className="text-2xl font-bold text-surface-950 tabular-nums mt-1">
            ${currentMonthSales.toFixed(2)}
          </p>
          <p className="text-[11px] text-surface-500 mt-0.5">
            {currentMonthCount} sale{currentMonthCount !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="glass-card rounded-xl p-4">
          <p className="text-[11px] text-surface-500 uppercase tracking-wider font-medium">
            All Time
          </p>
          <p className="text-2xl font-bold text-amber-500 tabular-nums mt-1">
            ${allTimeSales.toFixed(2)}
          </p>
          <p className="text-[11px] text-surface-500 mt-0.5">
            {filteredSales.length} sale{filteredSales.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {/* Quick Entry Form */}
      <form onSubmit={handleSubmit} className="glass-card rounded-xl p-4 space-y-3">
        <h2 className="text-sm font-semibold text-surface-900 flex items-center gap-2">
          <Plus className="w-4 h-4 text-amber-500" />
          New Sale
        </h2>

        {/* Customer */}
        <div>
          <label className="text-[11px] text-surface-500 uppercase tracking-wider font-medium block mb-1">
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
            className="w-full px-3 py-2.5 bg-surface-100 border border-border rounded-lg text-sm text-surface-950 placeholder:text-surface-500 focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400"
          />
          <datalist id="known-customers">
            {knownCustomers.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>

        {/* Product */}
        <div>
          <label className="text-[11px] text-surface-500 uppercase tracking-wider font-medium block mb-1">
            Product
          </label>
          <select
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            className="w-full px-3 py-2.5 bg-surface-100 border border-border rounded-lg text-sm text-surface-950 focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400"
          >
            {data.products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — ${p.price.toFixed(2)}
              </option>
            ))}
          </select>
        </div>

        {/* Qty + Date row */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] text-surface-500 uppercase tracking-wider font-medium block mb-1">
              Quantity
            </label>
            <input
              type="number"
              min={1}
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-full px-3 py-2.5 bg-surface-100 border border-border rounded-lg text-sm text-surface-950 text-center focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400"
            />
          </div>
          <div>
            <label className="text-[11px] text-surface-500 uppercase tracking-wider font-medium block mb-1">
              Date
            </label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full px-3 py-2.5 bg-surface-100 border border-border rounded-lg text-sm text-surface-950 focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400"
            />
          </div>
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={submitting || !person.trim() || !productId}
          className="w-full py-3 bg-amber-500 text-white font-semibold rounded-lg hover:bg-amber-400 active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-sm"
        >
          <DollarSign className="w-4 h-4" />
          Record Sale — ${lineTotal.toFixed(2)}
        </button>
      </form>

      {/* Sales History */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-surface-900">Sales History</h2>

        {months.length === 0 && (
          <div className="glass-card rounded-xl py-10 text-center">
            <Egg className="w-8 h-8 text-surface-300 mx-auto mb-2" />
            <p className="text-sm text-surface-500">No sales recorded yet</p>
          </div>
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
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm font-medium text-surface-900 truncate">
                    {monthLabel}
                  </span>
                  <span className="text-[11px] text-surface-500 shrink-0">
                    ({sales.length})
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-2">
                  <span className="text-sm font-bold text-amber-500 tabular-nums">
                    ${monthTotal.toFixed(2)}
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
                  {sales.map((sale) => {
                    const product = data.products.find((p) => p.id === sale.productId);
                    const isEditing = editingSaleId === sale.id;

                    if (isEditing) {
                      return (
                        <div key={sale.id} className="px-4 py-3 space-y-2 bg-surface-50">
                          <div>
                            <label className="text-[10px] text-surface-500 uppercase tracking-wider font-medium">
                              Customer
                            </label>
                            <input
                              type="text"
                              value={editPerson}
                              onChange={(e) => setEditPerson(e.target.value)}
                              list="known-customers-edit"
                              autoComplete="off"
                              className="w-full px-2.5 py-2 bg-white border border-border rounded-lg text-sm text-surface-950 focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400"
                            />
                            <datalist id="known-customers-edit">
                              {knownCustomers.map((c) => (
                                <option key={c} value={c} />
                              ))}
                            </datalist>
                          </div>
                          <div>
                            <label className="text-[10px] text-surface-500 uppercase tracking-wider font-medium">
                              Product
                            </label>
                            <select
                              value={editProductId}
                              onChange={(e) => setEditProductId(e.target.value)}
                              className="w-full px-2.5 py-2 bg-white border border-border rounded-lg text-sm text-surface-950 focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400"
                            >
                              {data.products.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.name} — ${p.price.toFixed(2)}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="text-[10px] text-surface-500 uppercase tracking-wider font-medium">
                                Qty
                              </label>
                              <input
                                type="number"
                                min={1}
                                value={editQuantity}
                                onChange={(e) =>
                                  setEditQuantity(Math.max(1, parseInt(e.target.value) || 1))
                                }
                                className="w-full px-2.5 py-2 bg-white border border-border rounded-lg text-sm text-surface-950 text-center focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] text-surface-500 uppercase tracking-wider font-medium">
                                Date
                              </label>
                              <input
                                type="date"
                                value={editDate}
                                onChange={(e) => setEditDate(e.target.value)}
                                className="w-full px-2.5 py-2 bg-white border border-border rounded-lg text-sm text-surface-950 focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400"
                              />
                            </div>
                          </div>
                          <div className="flex gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => void handleUpdateSale(sale.id)}
                              className="flex-1 py-2 bg-amber-500 text-white text-sm font-medium rounded-lg hover:bg-amber-400 active:scale-[0.98] transition-all flex items-center justify-center gap-1.5"
                            >
                              <Check className="w-3.5 h-3.5" />
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={cancelEditSale}
                              className="flex-1 py-2 bg-surface-200 text-surface-700 text-sm font-medium rounded-lg hover:bg-surface-300 active:scale-[0.98] transition-all flex items-center justify-center gap-1.5"
                            >
                              <X className="w-3.5 h-3.5" />
                              Cancel
                            </button>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div
                        key={sale.id}
                        className="px-4 py-3 border-b border-border/50 last:border-b-0"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-surface-950 truncate">
                              {sale.person}
                            </p>
                            <p className="text-[12px] text-surface-600 mt-0.5">
                              {product?.name || sale.productId}
                              {sale.quantity > 1 && (
                                <span className="text-surface-500"> x{sale.quantity}</span>
                              )}
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-sm font-bold text-surface-950 tabular-nums">
                              ${sale.total.toFixed(2)}
                            </p>
                            <p className="text-[11px] text-surface-500">
                              {new Date(sale.date + 'T00:00:00').toLocaleDateString('en-US', {
                                month: 'short',
                                day: 'numeric',
                              })}
                            </p>
                          </div>
                        </div>
                        {/* Action buttons */}
                        <div className="flex gap-1.5 mt-2">
                          <button
                            onClick={() => startEditSale(sale)}
                            className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium text-surface-600 bg-surface-100 rounded-lg hover:bg-surface-200 hover:text-surface-800 transition-colors"
                          >
                            <Pencil className="w-3 h-3" />
                            Edit
                          </button>
                          <button
                            onClick={() => void handleDelete(sale.id)}
                            className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium text-surface-600 bg-surface-100 rounded-lg hover:bg-danger-500/10 hover:text-danger-500 transition-colors"
                          >
                            <Trash2 className="w-3 h-3" />
                            Delete
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
            className="text-[12px] font-medium text-amber-500 hover:text-amber-400 transition-colors"
          >
            {showProductForm ? 'Cancel' : '+ Add'}
          </button>
        </div>

        {showProductForm && (
          <form onSubmit={handleAddProduct} className="glass-card rounded-xl p-3 space-y-2">
            <div className="grid grid-cols-[1fr,5rem] gap-2">
              <input
                type="text"
                value={newProductName}
                onChange={(e) => setNewProductName(e.target.value)}
                placeholder="Product name"
                required
                className="w-full px-3 py-2 bg-surface-100 border border-border rounded-lg text-sm text-surface-950 placeholder:text-surface-500 focus:outline-none focus:ring-2 focus:ring-amber-400/30"
              />
              <input
                type="number"
                step="0.01"
                min="0"
                value={newProductPrice}
                onChange={(e) => setNewProductPrice(e.target.value)}
                placeholder="$"
                required
                className="w-full px-3 py-2 bg-surface-100 border border-border rounded-lg text-sm text-surface-950 text-center placeholder:text-surface-500 focus:outline-none focus:ring-2 focus:ring-amber-400/30"
              />
            </div>
            <button
              type="submit"
              className="w-full py-2 bg-amber-500 text-white font-medium rounded-lg hover:bg-amber-400 active:scale-[0.98] transition-all text-sm"
            >
              Add Product
            </button>
          </form>
        )}

        <div className="glass-card rounded-xl overflow-hidden">
          {data.products.length === 0 && (
            <p className="text-sm text-surface-500 text-center py-6">No products added yet</p>
          )}
          {data.products.map((product) => {
            const isEditing = editingProductId === product.id;

            if (isEditing) {
              return (
                <div key={product.id} className="px-4 py-3 bg-surface-50 border-b border-border/50 last:border-b-0 space-y-2">
                  <div className="grid grid-cols-[1fr,5rem] gap-2">
                    <input
                      type="text"
                      value={editProductName}
                      onChange={(e) => setEditProductName(e.target.value)}
                      className="w-full px-2.5 py-2 bg-white border border-border rounded-lg text-sm text-surface-950 focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400"
                    />
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={editProductPrice}
                      onChange={(e) => setEditProductPrice(e.target.value)}
                      className="w-full px-2.5 py-2 bg-white border border-border rounded-lg text-sm text-surface-950 text-center focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => void handleUpdateProduct(product.id)}
                      className="flex-1 py-1.5 bg-amber-500 text-white text-sm font-medium rounded-lg hover:bg-amber-400 active:scale-[0.98] transition-all flex items-center justify-center gap-1"
                    >
                      <Check className="w-3.5 h-3.5" />
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={cancelEditProduct}
                      className="flex-1 py-1.5 bg-surface-200 text-surface-700 text-sm font-medium rounded-lg hover:bg-surface-300 active:scale-[0.98] transition-all flex items-center justify-center gap-1"
                    >
                      <X className="w-3.5 h-3.5" />
                      Cancel
                    </button>
                  </div>
                </div>
              );
            }

            return (
              <div
                key={product.id}
                className="px-4 py-3 border-b border-border/50 last:border-b-0"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-surface-900">{product.name}</span>
                  <span className="text-sm font-bold text-surface-950 tabular-nums">
                    ${product.price.toFixed(2)}
                  </span>
                </div>
                <div className="flex gap-1.5 mt-1.5">
                  <button
                    onClick={() => startEditProduct(product)}
                    className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-surface-600 bg-surface-100 rounded-md hover:bg-surface-200 hover:text-surface-800 transition-colors"
                  >
                    <Pencil className="w-2.5 h-2.5" />
                    Edit
                  </button>
                  <button
                    onClick={() => void handleDeleteProduct(product.id)}
                    className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-surface-600 bg-surface-100 rounded-md hover:bg-danger-500/10 hover:text-danger-500 transition-colors"
                  >
                    <Trash2 className="w-2.5 h-2.5" />
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
