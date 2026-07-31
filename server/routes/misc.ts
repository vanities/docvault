// Misc route handlers (todos, assets, contributions, geocode, dropbox, search, schedules).
// Extracted from server/index.ts. Reminders moved to /api/calendar/* (routes/calendar.ts).

import {
  loadAssets,
  saveAssets,
  loadContributions,
  saveContributions,
  loadEstimatedTaxes,
  saveEstimatedTaxes,
  loadFederalTax,
  saveFederalTax,
  loadTodos,
  saveTodos,
  jsonResponse,
} from '../data.js';
import type {
  BusinessAsset,
  Contribution401k,
  EstimatedTaxConfig,
  EstimatedTaxPayment,
  FederalTaxFiled,
  Todo,
} from '../data.js';
import { readJsonBody } from '../http.js';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Shape-validate a federal tax filing before persisting it wholesale —
// this route stores the body as-is, so reject anything that isn't the
// structure FederalTaxView sends (emptyFiled() always includes every field).
function isValidFederalTaxFiled(value: unknown): value is FederalTaxFiled {
  if (!isPlainObject(value)) return false;
  if (typeof value.filed !== 'boolean') return false;
  if (value.filedDate !== undefined && typeof value.filedDate !== 'string') return false;
  if (typeof value.agi !== 'number' || typeof value.taxableIncome !== 'number') return false;
  const sections = [
    'income',
    'adjustments',
    'deductions',
    'tax',
    'credits',
    'payments',
    'balance',
  ] as const;
  return sections.every((key) => isPlainObject(value[key]));
}

export async function handleMiscRoutes(
  req: Request,
  _url: URL,
  pathname: string
): Promise<Response | null> {
  // ========================================================================
  // Business Assets API
  // ========================================================================

  // GET /api/assets/:entity - Get assets for an entity
  const assetsGetMatch = pathname.match(/^\/api\/assets\/([^/]+)$/);
  if (assetsGetMatch && req.method === 'GET') {
    const entity = assetsGetMatch[1];
    const allAssets = await loadAssets();
    return jsonResponse({ assets: allAssets[entity] || [] });
  }

  // PUT /api/assets/:entity - Replace assets for an entity
  const assetsPutMatch = pathname.match(/^\/api\/assets\/([^/]+)$/);
  if (assetsPutMatch && req.method === 'PUT') {
    const entity = assetsPutMatch[1];
    const { assets } = await readJsonBody<{ assets?: BusinessAsset[] }>(req);
    if (!Array.isArray(assets)) {
      return jsonResponse({ error: 'assets must be an array' }, 400);
    }
    const allAssets = await loadAssets();
    allAssets[entity] = assets;
    await saveAssets(allAssets);
    return jsonResponse({ ok: true, assets });
  }

  // POST /api/assets/:entity/copy/:fromEntity - Copy assets from another entity
  const assetsCopyMatch = pathname.match(/^\/api\/assets\/([^/]+)\/copy\/([^/]+)$/);
  if (assetsCopyMatch && req.method === 'POST') {
    const toEntity = assetsCopyMatch[1];
    const fromEntity = assetsCopyMatch[2];
    const allAssets = await loadAssets();
    const source = allAssets[fromEntity] || [];
    const copied = source.map((a) => ({
      ...a,
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    }));
    allAssets[toEntity] = copied;
    await saveAssets(allAssets);
    return jsonResponse({ ok: true, assets: copied });
  }

  // ========================================================================
  // 401k Contributions API
  // ========================================================================

  // GET /api/contributions/:entity/:year
  const contribGetMatch = pathname.match(/^\/api\/contributions\/([^/]+)\/(\d{4})$/);
  if (contribGetMatch && req.method === 'GET') {
    const entity = contribGetMatch[1];
    const year = contribGetMatch[2];
    const allData = await loadContributions();

    if (entity === 'all') {
      // Aggregate contributions from all entities for this year
      const merged: (typeof allData)[string] = [];
      for (const [key, items] of Object.entries(allData)) {
        if (key.endsWith(`/${year}`) && key !== `all/${year}` && Array.isArray(items)) {
          merged.push(...items);
        }
      }
      merged.sort((a, b) => a.date.localeCompare(b.date));
      return jsonResponse({ contributions: merged });
    }

    return jsonResponse({ contributions: allData[`${entity}/${year}`] || [] });
  }

  // PUT /api/contributions/:entity/:year
  const contribPutMatch = pathname.match(/^\/api\/contributions\/([^/]+)\/(\d{4})$/);
  if (contribPutMatch && req.method === 'PUT') {
    const entity = contribPutMatch[1];
    // "all" is read-only — contributions must be edited per-entity
    if (entity === 'all') {
      return jsonResponse({ ok: true, readOnly: true });
    }
    const key = `${entity}/${contribPutMatch[2]}`;
    const { contributions } = await readJsonBody<{ contributions?: Contribution401k[] }>(req);
    if (!Array.isArray(contributions)) {
      return jsonResponse({ error: 'contributions must be an array' }, 400);
    }
    const allData = await loadContributions();
    allData[key] = contributions;
    await saveContributions(allData);
    return jsonResponse({ ok: true, contributions });
  }

  // ========================================================================
  // Estimated Tax Payments API
  // ========================================================================

  // GET /api/estimated-taxes/:entity/:year
  const estTaxGetMatch = pathname.match(/^\/api\/estimated-taxes\/([^/]+)\/(\d{4})$/);
  if (estTaxGetMatch && req.method === 'GET') {
    const key = `${estTaxGetMatch[1]}/${estTaxGetMatch[2]}`;
    const allData = await loadEstimatedTaxes();
    const entry = allData[key] || { payments: [], config: { annualTarget: 0 } };
    return jsonResponse(entry);
  }

  // PUT /api/estimated-taxes/:entity/:year
  const estTaxPutMatch = pathname.match(/^\/api\/estimated-taxes\/([^/]+)\/(\d{4})$/);
  if (estTaxPutMatch && req.method === 'PUT') {
    const key = `${estTaxPutMatch[1]}/${estTaxPutMatch[2]}`;
    const { payments, config } = await readJsonBody<{
      payments?: EstimatedTaxPayment[];
      config?: EstimatedTaxConfig;
    }>(req);
    if (!Array.isArray(payments)) {
      return jsonResponse({ error: 'payments must be an array' }, 400);
    }
    const allData = await loadEstimatedTaxes();
    allData[key] = { payments, config: config || allData[key]?.config || { annualTarget: 0 } };
    await saveEstimatedTaxes(allData);
    return jsonResponse({ ok: true, ...allData[key] });
  }

  // ========================================================================
  // Federal Tax API (filed 1040 data)
  // ========================================================================

  // GET /api/federal-tax - Get all years
  if (pathname === '/api/federal-tax' && req.method === 'GET') {
    const allData = await loadFederalTax();
    return jsonResponse(allData);
  }

  // GET /api/federal-tax/:year
  const fedTaxGetMatch = pathname.match(/^\/api\/federal-tax\/(\d{4})$/);
  if (fedTaxGetMatch && req.method === 'GET') {
    const year = fedTaxGetMatch[1];
    const allData = await loadFederalTax();
    const entry = allData[year] || null;
    return jsonResponse(entry);
  }

  // PUT /api/federal-tax/:year
  const fedTaxPutMatch = pathname.match(/^\/api\/federal-tax\/(\d{4})$/);
  if (fedTaxPutMatch && req.method === 'PUT') {
    const year = fedTaxPutMatch[1];
    const body = await readJsonBody<unknown>(req);
    if (!isValidFederalTaxFiled(body)) {
      return jsonResponse({ error: 'Invalid federal tax filing shape' }, 400);
    }
    const allData = await loadFederalTax();
    allData[year] = body;
    await saveFederalTax(allData);
    return jsonResponse({ ok: true, ...allData[year] });
  }

  // ========================================================================
  // Todos API
  // ========================================================================

  // GET /api/todos - Get all todos
  if (pathname === '/api/todos' && req.method === 'GET') {
    const todos = await loadTodos();
    return jsonResponse({ todos });
  }

  // POST /api/todos - Create a todo
  if (pathname === '/api/todos' && req.method === 'POST') {
    const { title } = await readJsonBody<Partial<Todo>>(req);

    if (!title) {
      return jsonResponse({ error: 'Missing title' }, 400);
    }

    const now = new Date().toISOString();
    const todo: Todo = {
      id: crypto.randomUUID(),
      title,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };

    const todos = await loadTodos();
    todos.push(todo);
    await saveTodos(todos);

    return jsonResponse({ ok: true, todo });
  }

  // PUT /api/todos/:id - Update a todo
  const todoUpdateMatch = pathname.match(/^\/api\/todos\/([^/]+)$/);
  if (todoUpdateMatch && req.method === 'PUT') {
    const todoId = todoUpdateMatch[1];
    const body = await readJsonBody<Partial<Todo>>(req);

    const todos = await loadTodos();
    const idx = todos.findIndex((t) => t.id === todoId);
    if (idx === -1) {
      return jsonResponse({ error: 'Todo not found' }, 404);
    }

    const { title, status } = body;
    if (title !== undefined) todos[idx].title = title;
    if (status !== undefined) todos[idx].status = status;
    todos[idx].updatedAt = new Date().toISOString();

    await saveTodos(todos);
    return jsonResponse({ ok: true, todo: todos[idx] });
  }

  // DELETE /api/todos/:id
  const todoDeleteMatch = pathname.match(/^\/api\/todos\/([^/]+)$/);
  if (todoDeleteMatch && req.method === 'DELETE') {
    const todoId = todoDeleteMatch[1];
    const todos = await loadTodos();
    const filtered = todos.filter((t) => t.id !== todoId);
    if (filtered.length === todos.length) {
      return jsonResponse({ error: 'Todo not found' }, 404);
    }
    await saveTodos(filtered);
    return jsonResponse({ ok: true });
  }

  return null;
}
