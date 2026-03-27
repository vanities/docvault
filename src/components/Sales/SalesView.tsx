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
  Settings,
} from 'lucide-react';
import type { Sale, SaleProduct, SalesData } from '../../types';
import { useAppContext } from '../../contexts/AppContext';
import { useToast } from '../../hooks/useToast';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const API = '/api/sales';

export function SalesView() {
  const { selectedEntity, entities } = useAppContext();
  const { addToast } = useToast();
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
  const [productsDialogOpen, setProductsDialogOpen] = useState(false);

  // Edit state — sales
  const [editingSaleId, setEditingSaleId] = useState<string | null>(null);
  const [editPerson, setEditPerson] = useState('');
  const [editProductId, setEditProductId] = useState('');
  const [editQuantity, setEditQuantity] = useState(1);
  const [editDate, setEditDate] = useState('');

  // Edit state — products
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [editProductName, setEditProductName] = useState('');
  const [editProductPrice, setEditProductPrice] = useState('');

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

  // ── CRUD handlers ─────────────────────────────────────────────────
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
        addToast('Sale recorded', 'success');
      } else {
        addToast('Failed to record sale', 'error');
      }
    } catch {
      addToast('Failed to record sale', 'error');
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

  const handleUpdateProduct = async (id: string) => {
    await fetch(`${API}/products/${id}`, {
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

  // ── Derived data ──────────────────────────────────────────────────
  const filteredSales =
    selectedEntity === 'all' ? data.sales : data.sales.filter((s) => s.entity === selectedEntity);

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
  const currentMonth = new Date().toISOString().substring(0, 7);
  const activeMonth = expandedMonth ?? currentMonth;
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
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl text-surface-950">Sales Tracker</h1>
          <p className="text-[12px] text-surface-600 truncate">
            {entityName || (selectedEntity === 'all' ? 'All Entities' : selectedEntity)}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setProductsDialogOpen(true)}
          className="shrink-0"
          title="Manage Products"
        >
          <Settings className="w-4 h-4" />
        </Button>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 gap-3">
        <Card variant="glass" className="p-4">
          <p className="text-[11px] text-surface-500 uppercase tracking-wider font-medium">
            This Month
          </p>
          <p className="text-2xl font-bold text-surface-950 tabular-nums mt-1">
            ${currentMonthSales.toFixed(2)}
          </p>
          <p className="text-[11px] text-surface-500 mt-0.5">
            {currentMonthCount} sale{currentMonthCount !== 1 ? 's' : ''}
          </p>
        </Card>
        <Card variant="glass" className="p-4">
          <p className="text-[11px] text-surface-500 uppercase tracking-wider font-medium">
            All Time
          </p>
          <p className="text-2xl font-bold text-amber-500 tabular-nums mt-1">
            ${allTimeSales.toFixed(2)}
          </p>
          <p className="text-[11px] text-surface-500 mt-0.5">
            {filteredSales.length} sale{filteredSales.length !== 1 ? 's' : ''}
          </p>
        </Card>
      </div>

      {/* New Sale Form */}
      <form onSubmit={handleSubmit} className="glass-card rounded-xl p-4 space-y-3">
        <h2 className="text-sm font-semibold text-surface-900">New Sale</h2>

        <div>
          <Label className="mb-1">Customer</Label>
          <Input
            type="text"
            value={person}
            onChange={(e) => setPerson(e.target.value)}
            placeholder="John Smith"
            list="known-customers"
            required
            autoComplete="off"
          />
          <datalist id="known-customers">
            {knownCustomers.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>

        <div>
          <Label className="mb-1">Product</Label>
          <Select value={productId} onValueChange={setProductId}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {data.products.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name} — ${p.price.toFixed(2)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="mb-1">Quantity</Label>
            <Input
              type="number"
              min={1}
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
              className="text-center"
            />
          </div>
          <div>
            <Label className="mb-1">Date</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>

        <Button
          type="submit"
          disabled={submitting || !person.trim() || !productId}
          size="lg"
          className="w-full bg-amber-500 hover:bg-amber-400"
        >
          <DollarSign className="w-4 h-4" />
          Record Sale — ${lineTotal.toFixed(2)}
        </Button>
      </form>

      {/* Sales History */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-surface-900">Sales History</h2>

        {months.length === 0 && (
          <Card variant="glass" className="py-10 text-center">
            <Egg className="w-8 h-8 text-surface-300 mx-auto mb-2" />
            <p className="text-sm text-surface-500">No sales recorded yet</p>
          </Card>
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
                  <span className="text-[11px] text-surface-500 shrink-0">({sales.length})</span>
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
                        <div
                          key={sale.id}
                          className="px-4 py-3 space-y-2 bg-surface-50 border-b border-border/50 last:border-b-0"
                        >
                          <div>
                            <Label className="text-[10px]">Customer</Label>
                            <Input
                              type="text"
                              value={editPerson}
                              onChange={(e) => setEditPerson(e.target.value)}
                              list="known-customers-edit"
                              autoComplete="off"
                              className="bg-surface-50"
                            />
                            <datalist id="known-customers-edit">
                              {knownCustomers.map((c) => (
                                <option key={c} value={c} />
                              ))}
                            </datalist>
                          </div>
                          <div>
                            <Label className="text-[10px]">Product</Label>
                            <Select value={editProductId} onValueChange={setEditProductId}>
                              <SelectTrigger className="w-full">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {data.products.map((p) => (
                                  <SelectItem key={p.id} value={p.id}>
                                    {p.name} — ${p.price.toFixed(2)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <Label className="text-[10px]">Qty</Label>
                              <Input
                                type="number"
                                min={1}
                                value={editQuantity}
                                onChange={(e) =>
                                  setEditQuantity(Math.max(1, parseInt(e.target.value) || 1))
                                }
                                className="bg-surface-50 text-center"
                              />
                            </div>
                            <div>
                              <Label className="text-[10px]">Date</Label>
                              <Input
                                type="date"
                                value={editDate}
                                onChange={(e) => setEditDate(e.target.value)}
                                className="bg-surface-50"
                              />
                            </div>
                          </div>
                          <div className="flex gap-2 pt-1">
                            <Button
                              type="button"
                              onClick={() => void handleUpdateSale(sale.id)}
                              className="flex-1 bg-amber-500 hover:bg-amber-400"
                            >
                              <Check className="w-3.5 h-3.5" /> Save
                            </Button>
                            <Button
                              type="button"
                              variant="secondary"
                              onClick={() => setEditingSaleId(null)}
                              className="flex-1"
                            >
                              <X className="w-3.5 h-3.5" /> Cancel
                            </Button>
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
                        <div className="flex gap-2 mt-2.5">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => startEditSale(sale)}
                          >
                            <Pencil className="w-3 h-3" /> Edit
                          </Button>
                          <Button
                            type="button"
                            variant="ghost-danger"
                            size="sm"
                            onClick={() => void handleDelete(sale.id)}
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

      {/* Products Dialog */}
      <Dialog open={productsDialogOpen} onOpenChange={setProductsDialogOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-md max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="w-4 h-4 text-surface-600" />
              Products
            </DialogTitle>
            <DialogDescription>Manage your product catalog</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="flex justify-end">
              {showProductForm ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowProductForm(false)}
                >
                  <X className="w-3 h-3" /> Cancel
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="text-amber-600 bg-amber-500/10 border-amber-500/20 hover:bg-amber-500/15"
                  onClick={() => setShowProductForm(true)}
                >
                  <Plus className="w-3 h-3" /> Add
                </Button>
              )}
            </div>

            {showProductForm && (
              <form onSubmit={handleAddProduct} className="glass-card rounded-xl p-3 space-y-2">
                <div className="grid grid-cols-[1fr_5rem] gap-2">
                  <Input
                    type="text"
                    value={newProductName}
                    onChange={(e) => setNewProductName(e.target.value)}
                    placeholder="Eggs (dozen)"
                    required
                  />
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={newProductPrice}
                    onChange={(e) => setNewProductPrice(e.target.value)}
                    placeholder="5.00"
                    required
                    className="text-center"
                  />
                </div>
                <Button type="submit" className="w-full bg-amber-500 hover:bg-amber-400">
                  Add Product
                </Button>
              </form>
            )}

            <Card variant="glass" className="overflow-hidden">
              {data.products.length === 0 && (
                <p className="text-sm text-surface-500 text-center py-6">No products added yet</p>
              )}
              {data.products.map((product) => {
                const isEditing = editingProductId === product.id;

                if (isEditing) {
                  return (
                    <div
                      key={product.id}
                      className="px-4 py-3 bg-surface-50 border-b border-border/50 last:border-b-0 space-y-2"
                    >
                      <div className="grid grid-cols-[1fr_5rem] gap-2">
                        <Input
                          type="text"
                          value={editProductName}
                          onChange={(e) => setEditProductName(e.target.value)}
                          className="bg-surface-50"
                        />
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={editProductPrice}
                          onChange={(e) => setEditProductPrice(e.target.value)}
                          className="bg-surface-50 text-center"
                        />
                      </div>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          onClick={() => void handleUpdateProduct(product.id)}
                          className="flex-1 bg-amber-500 hover:bg-amber-400"
                        >
                          <Check className="w-3.5 h-3.5" /> Save
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => setEditingProductId(null)}
                          className="flex-1"
                        >
                          <X className="w-3.5 h-3.5" /> Cancel
                        </Button>
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
                    <div className="flex gap-2 mt-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => startEditProduct(product)}
                      >
                        <Pencil className="w-3 h-3" /> Edit
                      </Button>
                      <Button
                        type="button"
                        variant="ghost-danger"
                        size="sm"
                        onClick={() => void handleDeleteProduct(product.id)}
                      >
                        <Trash2 className="w-3 h-3" /> Delete
                      </Button>
                    </div>
                  </div>
                );
              })}
            </Card>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
