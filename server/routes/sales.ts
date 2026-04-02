// Sales route handlers.
// Extracted from server/index.ts.

import { promises as fs } from 'fs';
import path from 'path';
import { loadSalesData, saveSalesData, jsonResponse } from '../data.js';

export async function handleSalesRoutes(
  req: Request,
  url: URL,
  pathname: string
): Promise<Response | null> {
  // ========================================================================
  // Sales API
  // ========================================================================

  // GET /api/sales - Get all sales data (products + sales)
  if (pathname === '/api/sales' && req.method === 'GET') {
    const data = await loadSalesData();
    return jsonResponse(data);
  }

  // POST /api/sales - Create a new sale
  if (pathname === '/api/sales' && req.method === 'POST') {
    const body = await req.json();
    const { person, productId, quantity, date, entity } = body;

    if (!person || !productId) {
      return jsonResponse({ error: 'Missing person or productId' }, 400);
    }

    const data = await loadSalesData();
    const product = data.products.find((p: SaleProduct) => p.id === productId);
    if (!product) {
      return jsonResponse({ error: 'Product not found' }, 404);
    }

    const qty = quantity || 1;
    const sale: Sale = {
      id: crypto.randomUUID(),
      person: person.trim(),
      productId,
      quantity: qty,
      total: product.price * qty,
      date: date || new Date().toISOString().split('T')[0],
      entity: entity || undefined,
      createdAt: new Date().toISOString(),
    };

    data.sales.push(sale);
    await saveSalesData(data);
    return jsonResponse({ ok: true, sale });
  }

  // PUT /api/sales/:id - Update a sale
  const saleUpdateMatch = pathname.match(/^\/api\/sales\/([^/]+)$/);
  if (saleUpdateMatch && req.method === 'PUT') {
    const saleId = saleUpdateMatch[1];
    const body = await req.json();
    const data = await loadSalesData();
    const sale = data.sales.find((s: Sale) => s.id === saleId);
    if (!sale) {
      return jsonResponse({ error: 'Sale not found' }, 404);
    }
    if (body.person !== undefined) sale.person = body.person.trim();
    if (body.productId !== undefined) {
      const product = data.products.find((p: SaleProduct) => p.id === body.productId);
      if (!product) return jsonResponse({ error: 'Product not found' }, 404);
      sale.productId = body.productId;
      sale.total = product.price * (body.quantity !== undefined ? body.quantity : sale.quantity);
    }
    if (body.quantity !== undefined) {
      sale.quantity = body.quantity;
      const product = data.products.find((p: SaleProduct) => p.id === sale.productId);
      if (product) sale.total = product.price * sale.quantity;
    }
    if (body.date !== undefined) sale.date = body.date;
    await saveSalesData(data);
    return jsonResponse({ ok: true, sale });
  }

  // DELETE /api/sales/:id - Delete a sale
  const saleDeleteMatch = pathname.match(/^\/api\/sales\/([^/]+)$/);
  if (saleDeleteMatch && req.method === 'DELETE') {
    const saleId = saleDeleteMatch[1];
    const data = await loadSalesData();
    const filtered = data.sales.filter((s: Sale) => s.id !== saleId);
    if (filtered.length === data.sales.length) {
      return jsonResponse({ error: 'Sale not found' }, 404);
    }
    data.sales = filtered;
    await saveSalesData(data);
    return jsonResponse({ ok: true });
  }

  // POST /api/sales/products - Add a new product
  if (pathname === '/api/sales/products' && req.method === 'POST') {
    const body = await req.json();
    const { name, price } = body;

    if (!name || price === undefined) {
      return jsonResponse({ error: 'Missing name or price' }, 400);
    }

    const data = await loadSalesData();
    const product: SaleProduct = {
      id: crypto.randomUUID(),
      name: name.trim(),
      price: Number(price),
    };

    data.products.push(product);
    await saveSalesData(data);
    return jsonResponse({ ok: true, product });
  }

  // PUT /api/sales/products/:id - Update a product
  const productUpdateMatch = pathname.match(/^\/api\/sales\/products\/([^/]+)$/);
  if (productUpdateMatch && req.method === 'PUT') {
    const productId = productUpdateMatch[1];
    const body = await req.json();
    const data = await loadSalesData();
    const product = data.products.find((p: SaleProduct) => p.id === productId);
    if (!product) {
      return jsonResponse({ error: 'Product not found' }, 404);
    }
    if (body.name !== undefined) product.name = body.name.trim();
    if (body.price !== undefined) product.price = Number(body.price);
    await saveSalesData(data);
    return jsonResponse({ ok: true, product });
  }

  // DELETE /api/sales/products/:id - Delete a product
  const productDeleteMatch = pathname.match(/^\/api\/sales\/products\/([^/]+)$/);
  if (productDeleteMatch && req.method === 'DELETE') {
    const productId = productDeleteMatch[1];
    const data = await loadSalesData();
    const filtered = data.products.filter((p: SaleProduct) => p.id !== productId);
    if (filtered.length === data.products.length) {
      return jsonResponse({ error: 'Product not found' }, 404);
    }
    data.products = filtered;
    await saveSalesData(data);
    return jsonResponse({ ok: true });
  }
  return null;
}
