// Misc route handlers (reminders, todos, assets, contributions, geocode, dropbox, search, schedules).
// Extracted from server/index.ts.

import { promises as fs } from 'fs';
import path from 'path';
import { loadReminders, saveReminders, loadAssets, saveAssets, loadContributions, saveContributions, loadTodos, saveTodos, loadSettings, saveSettings, jsonResponse, corsHeaders, DATA_DIR, CRYPTO_CACHE_FILE, BROKER_CACHE_FILE, SIMPLEFIN_CACHE_FILE } from '../data.js';

export async function handleMiscRoutes(
  req: Request,
  url: URL,
  pathname: string
): Promise<Response | null> {

  // GET /api/reminders - Get all reminders (optionally filter by entity)
  if (pathname === '/api/reminders' && req.method === 'GET') {
    const entityFilter = url.searchParams.get('entity');
    let reminders = await loadReminders();
    if (entityFilter) {
      reminders = reminders.filter((r) => r.entityId === entityFilter);
    }
    return jsonResponse({ reminders });
  }

  // POST /api/reminders - Create a reminder
  if (pathname === '/api/reminders' && req.method === 'POST') {
    const body = await req.json();
    const { entityId, title, dueDate, recurrence, notes } = body;

    if (!entityId || !title || !dueDate) {
      return jsonResponse({ error: 'Missing entityId, title, or dueDate' }, 400);
    }

    const now = new Date().toISOString();
    const reminder: Reminder = {
      id: crypto.randomUUID(),
      entityId,
      title,
      dueDate,
      recurrence: recurrence || null,
      status: 'pending',
      notes: notes || undefined,
      createdAt: now,
      updatedAt: now,
    };

    const reminders = await loadReminders();
    reminders.push(reminder);
    await saveReminders(reminders);

    return jsonResponse({ ok: true, reminder });
  }

  // PUT /api/reminders/:id - Update a reminder
  const reminderUpdateMatch = pathname.match(/^\/api\/reminders\/([^/]+)$/);
  if (reminderUpdateMatch && req.method === 'PUT') {
    const reminderId = reminderUpdateMatch[1];
    const body = await req.json();

    const reminders = await loadReminders();
    const idx = reminders.findIndex((r) => r.id === reminderId);
    if (idx === -1) {
      return jsonResponse({ error: 'Reminder not found' }, 404);
    }

    const { title, dueDate, recurrence, status, notes } = body;
    if (title !== undefined) reminders[idx].title = title;
    if (dueDate !== undefined) reminders[idx].dueDate = dueDate;
    if (recurrence !== undefined) reminders[idx].recurrence = recurrence;
    if (status !== undefined) reminders[idx].status = status;
    if (notes !== undefined) reminders[idx].notes = notes;
    reminders[idx].updatedAt = new Date().toISOString();

    // If completing a recurring reminder, create the next one
    if (status === 'completed' && reminders[idx].recurrence) {
      const current = new Date(reminders[idx].dueDate);
      let nextDate: Date;
      switch (reminders[idx].recurrence) {
        case 'yearly':
          nextDate = new Date(current);
          nextDate.setFullYear(nextDate.getFullYear() + 1);
          break;
        case 'quarterly':
          nextDate = new Date(current);
          nextDate.setMonth(nextDate.getMonth() + 3);
          break;
        case 'monthly':
          nextDate = new Date(current);
          nextDate.setMonth(nextDate.getMonth() + 1);
          break;
        default:
          nextDate = current;
      }

      const now = new Date().toISOString();
      reminders.push({
        id: crypto.randomUUID(),
        entityId: reminders[idx].entityId,
        title: reminders[idx].title,
        dueDate: nextDate.toISOString().split('T')[0],
        recurrence: reminders[idx].recurrence,
        status: 'pending',
        notes: reminders[idx].notes,
        createdAt: now,
        updatedAt: now,
      });
    }

    await saveReminders(reminders);
    return jsonResponse({ ok: true, reminder: reminders[idx] });
  }

  // DELETE /api/reminders/:id
  const reminderDeleteMatch = pathname.match(/^\/api\/reminders\/([^/]+)$/);
  if (reminderDeleteMatch && req.method === 'DELETE') {
    const reminderId = reminderDeleteMatch[1];
    const reminders = await loadReminders();
    const filtered = reminders.filter((r) => r.id !== reminderId);
    if (filtered.length === reminders.length) {
      return jsonResponse({ error: 'Reminder not found' }, 404);
    }
    await saveReminders(filtered);
    return jsonResponse({ ok: true });
  }

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
    const body = await req.json();
    const { assets } = body;
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
    const key = `${contribGetMatch[1]}/${contribGetMatch[2]}`;
    const allData = await loadContributions();
    return jsonResponse({ contributions: allData[key] || [] });
  }

  // PUT /api/contributions/:entity/:year
  const contribPutMatch = pathname.match(/^\/api\/contributions\/([^/]+)\/(\d{4})$/);
  if (contribPutMatch && req.method === 'PUT') {
    const key = `${contribPutMatch[1]}/${contribPutMatch[2]}`;
    const body = await req.json();
    const { contributions } = body;
    if (!Array.isArray(contributions)) {
      return jsonResponse({ error: 'contributions must be an array' }, 400);
    }
    const allData = await loadContributions();
    allData[key] = contributions;
    await saveContributions(allData);
    return jsonResponse({ ok: true, contributions });
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
    const body = await req.json();
    const { title } = body;

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
    const body = await req.json();

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
  // sales routes (extracted to routes/sales.ts)
  const salesResponse = await handleSalesRoutes(req, url, pathname);
  if (salesResponse) return salesResponse;
  // mileage routes (extracted to routes/mileage.ts)
  const mileageResponse = await handleMileageRoutes(req, url, pathname);
  if (mileageResponse) return mileageResponse;
  // gold routes (extracted to routes/gold.ts)
  const goldResponse = await handleGoldRoutes(req, url, pathname);
  if (goldResponse) return goldResponse;
  return null;
}
