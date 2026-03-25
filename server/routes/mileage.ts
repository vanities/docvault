// Mileage route handlers.
// Extracted from server/index.ts.

import { promises as fs } from 'fs';
import path from 'path';
import { loadMileageData, saveMileageData, loadSettings, jsonResponse } from '../data.js';

export async function handleMileageRoutes(
  req: Request,
  url: URL,
  pathname: string
): Promise<Response | null> {


  // ========================================================================
  // Mileage API
  // ========================================================================

  // GET /api/mileage - Get all mileage data (vehicles + entries + irsRate)
  if (pathname === '/api/mileage' && req.method === 'GET') {
    const data = await loadMileageData();
    return jsonResponse(data);
  }

  // POST /api/mileage - Create a new mileage entry
  if (pathname === '/api/mileage' && req.method === 'POST') {
    const body = await req.json();
    const {
      date,
      vehicleId,
      odometerStart,
      odometerEnd,
      tripMiles,
      gallons,
      totalCost,
      purpose,
      entity,
    } = body;

    if (!vehicleId) {
      return jsonResponse({ error: 'Missing vehicleId' }, 400);
    }

    const data = await loadMileageData();
    const vehicle = data.vehicles.find((v: Vehicle) => v.id === vehicleId);
    if (!vehicle) {
      return jsonResponse({ error: 'Vehicle not found' }, 404);
    }

    // Auto-calculate tripMiles from odometer if both provided and tripMiles not given
    let computedTripMiles = tripMiles;
    if (
      computedTripMiles === undefined &&
      odometerStart !== undefined &&
      odometerEnd !== undefined
    ) {
      computedTripMiles = odometerEnd - odometerStart;
    }

    const entry: MileageEntry = {
      id: crypto.randomUUID(),
      date: date || new Date().toISOString().split('T')[0],
      vehicleId,
      odometerStart: odometerStart !== undefined ? Number(odometerStart) : undefined,
      odometerEnd: odometerEnd !== undefined ? Number(odometerEnd) : undefined,
      tripMiles: computedTripMiles !== undefined ? Number(computedTripMiles) : undefined,
      gallons: gallons !== undefined ? Number(gallons) : undefined,
      totalCost: totalCost !== undefined ? Number(totalCost) : undefined,
      purpose: purpose?.trim() || undefined,
      entity: entity || undefined,
      createdAt: new Date().toISOString(),
    };

    data.entries.push(entry);
    await saveMileageData(data);
    return jsonResponse({ ok: true, entry });
  }

  // PUT /api/mileage/:id - Update a mileage entry
  const mileageUpdateMatch = pathname.match(/^\/api\/mileage\/([^/]+)$/);
  if (mileageUpdateMatch && req.method === 'PUT') {
    const entryId = mileageUpdateMatch[1];
    const body = await req.json();
    const data = await loadMileageData();
    const entry = data.entries.find((e: MileageEntry) => e.id === entryId);
    if (!entry) {
      return jsonResponse({ error: 'Entry not found' }, 404);
    }
    if (body.date !== undefined) entry.date = body.date;
    if (body.vehicleId !== undefined) {
      const vehicle = data.vehicles.find((v: Vehicle) => v.id === body.vehicleId);
      if (!vehicle) return jsonResponse({ error: 'Vehicle not found' }, 404);
      entry.vehicleId = body.vehicleId;
    }
    if (body.odometerStart !== undefined) entry.odometerStart = body.odometerStart === '' ? undefined : Number(body.odometerStart);
    if (body.odometerEnd !== undefined) entry.odometerEnd = body.odometerEnd === '' ? undefined : Number(body.odometerEnd);
    if (body.tripMiles !== undefined) entry.tripMiles = body.tripMiles === '' ? undefined : Number(body.tripMiles);
    if (body.gallons !== undefined) entry.gallons = body.gallons === '' ? undefined : Number(body.gallons);
    if (body.totalCost !== undefined) entry.totalCost = body.totalCost === '' ? undefined : Number(body.totalCost);
    if (body.purpose !== undefined) entry.purpose = body.purpose?.trim() || undefined;
    await saveMileageData(data);
    return jsonResponse({ ok: true, entry });
  }

  // DELETE /api/mileage/:id - Delete a mileage entry
  const mileageDeleteMatch = pathname.match(/^\/api\/mileage\/([^/]+)$/);
  if (mileageDeleteMatch && req.method === 'DELETE') {
    const entryId = mileageDeleteMatch[1];
    const data = await loadMileageData();
    const filtered = data.entries.filter((e: MileageEntry) => e.id !== entryId);
    if (filtered.length === data.entries.length) {
      return jsonResponse({ error: 'Entry not found' }, 404);
    }
    data.entries = filtered;
    await saveMileageData(data);
    return jsonResponse({ ok: true });
  }

  // POST /api/mileage/vehicles - Add a new vehicle
  if (pathname === '/api/mileage/vehicles' && req.method === 'POST') {
    const body = await req.json();
    const { name, year, make, model } = body;

    if (!name) {
      return jsonResponse({ error: 'Missing vehicle name' }, 400);
    }

    const data = await loadMileageData();
    const vehicle: Vehicle = {
      id: crypto.randomUUID(),
      name: name.trim(),
      year: year !== undefined ? Number(year) : undefined,
      make: make?.trim() || undefined,
      model: model?.trim() || undefined,
    };

    data.vehicles.push(vehicle);
    await saveMileageData(data);
    return jsonResponse({ ok: true, vehicle });
  }

  // PUT /api/mileage/vehicles/:id - Update a vehicle
  const vehicleUpdateMatch = pathname.match(/^\/api\/mileage\/vehicles\/([^/]+)$/);
  if (vehicleUpdateMatch && req.method === 'PUT') {
    const vehicleId = vehicleUpdateMatch[1];
    const body = await req.json();
    const data = await loadMileageData();
    const vehicle = data.vehicles.find((v: Vehicle) => v.id === vehicleId);
    if (!vehicle) {
      return jsonResponse({ error: 'Vehicle not found' }, 404);
    }
    if (body.name !== undefined) vehicle.name = body.name.trim();
    if (body.year !== undefined) vehicle.year = body.year === '' ? undefined : Number(body.year);
    if (body.make !== undefined) vehicle.make = body.make?.trim() || undefined;
    if (body.model !== undefined) vehicle.model = body.model?.trim() || undefined;
    await saveMileageData(data);
    return jsonResponse({ ok: true, vehicle });
  }

  // DELETE /api/mileage/vehicles/:id - Delete a vehicle
  const vehicleDeleteMatch = pathname.match(/^\/api\/mileage\/vehicles\/([^/]+)$/);
  if (vehicleDeleteMatch && req.method === 'DELETE') {
    const vehicleId = vehicleDeleteMatch[1];
    const data = await loadMileageData();
    const filtered = data.vehicles.filter((v: Vehicle) => v.id !== vehicleId);
    if (filtered.length === data.vehicles.length) {
      return jsonResponse({ error: 'Vehicle not found' }, 404);
    }
    data.vehicles = filtered;
    await saveMileageData(data);
    return jsonResponse({ ok: true });
  }

  // PUT /api/mileage/settings - Update IRS rate
  if (pathname === '/api/mileage/settings' && req.method === 'PUT') {
    const body = await req.json();
    const data = await loadMileageData();
    if (body.irsRate !== undefined) {
      data.irsRate = Number(body.irsRate);
    }
    await saveMileageData(data);
    return jsonResponse({ ok: true });
  }

  // POST /api/mileage/addresses - Add a saved address
  if (pathname === '/api/mileage/addresses' && req.method === 'POST') {
    const body = await req.json();
    const { label, formatted, lat, lon } = body;
    if (!label || !formatted || lat == null || lon == null) {
      return jsonResponse({ error: 'Missing label, formatted, lat, or lon' }, 400);
    }
    const data = await loadMileageData();
    if (!data.savedAddresses) data.savedAddresses = [];
    const addr: SavedAddress = {
      id: crypto.randomUUID(),
      label: label.trim(),
      formatted: formatted.trim(),
      lat: Number(lat),
      lon: Number(lon),
    };
    data.savedAddresses.push(addr);
    await saveMileageData(data);
    return jsonResponse({ ok: true, address: addr });
  }

  // PUT /api/mileage/addresses/:id - Update a saved address
  const addrUpdateMatch = pathname.match(/^\/api\/mileage\/addresses\/([^/]+)$/);
  if (addrUpdateMatch && req.method === 'PUT') {
    const addrId = addrUpdateMatch[1];
    const body = await req.json();
    const data = await loadMileageData();
    if (!data.savedAddresses) data.savedAddresses = [];
    const addr = data.savedAddresses.find((a) => a.id === addrId);
    if (!addr) {
      return jsonResponse({ error: 'Address not found' }, 404);
    }
    if (body.label !== undefined) addr.label = body.label.trim();
    if (body.formatted !== undefined) addr.formatted = body.formatted.trim();
    if (body.lat !== undefined) addr.lat = Number(body.lat);
    if (body.lon !== undefined) addr.lon = Number(body.lon);
    await saveMileageData(data);
    return jsonResponse({ ok: true, address: addr });
  }

  // DELETE /api/mileage/addresses/:id - Delete a saved address
  const addrDeleteMatch = pathname.match(/^\/api\/mileage\/addresses\/([^/]+)$/);
  if (addrDeleteMatch && req.method === 'DELETE') {
    const addrId = addrDeleteMatch[1];
    const data = await loadMileageData();
    if (!data.savedAddresses) data.savedAddresses = [];
    const filtered = data.savedAddresses.filter((a) => a.id !== addrId);
    if (filtered.length === (data.savedAddresses?.length || 0)) {
      return jsonResponse({ error: 'Address not found' }, 404);
    }
    data.savedAddresses = filtered;
    await saveMileageData(data);
    return jsonResponse({ ok: true });
  }
  return null;
}
