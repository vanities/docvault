// All customers, amounts, vehicles and coordinates here are fabricated.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function seedNativeBusiness(dataDir: string, empty = false) {
  const settingsPath = path.join(dataDir, '.docvault-settings.json');
  const settings = JSON.parse(await readFile(settingsPath, 'utf8'));
  settings.geoapifyApiKey = empty ? '' : 'synthetic-geocode-key';
  await writeFile(settingsPath, JSON.stringify(settings));
  const files = {
    '.docvault-sales.json': {
      products: empty
        ? []
        : [
            { id: 'business-box', name: 'Acme Orchard Box', price: 10 },
            { id: 'business-garden', name: 'Acme Garden Box', price: 25 },
          ],
      sales: empty
        ? []
        : [
            {
              id: 'business-sale1',
              person: 'Acme Customer',
              productId: 'business-box',
              quantity: 2,
              total: 20,
              date: '2026-01-12',
              entity: 'acme',
            },
            {
              id: 'business-sale2',
              person: 'Acme Market',
              productId: 'business-garden',
              quantity: 2,
              total: 50,
              date: '2026-09-18',
              entity: 'acme',
            },
            {
              id: 'business-zero',
              person: 'Acme Customer',
              productId: 'business-box',
              quantity: 1,
              total: 0,
              date: '2026-09-20',
              entity: 'acme',
            },
            {
              id: 'business-removed',
              person: 'Acme Archived Customer',
              productId: 'retired-product',
              quantity: 1,
              total: 15,
              date: '2026-03-19',
              entity: 'acme',
            },
            {
              id: 'business-old',
              person: 'Acme Prior Customer',
              productId: 'business-box',
              quantity: 3,
              total: 30,
              date: '2025-01-12',
              entity: 'acme',
            },
            {
              id: 'business-other',
              person: 'Other Acme Customer',
              productId: 'business-garden',
              quantity: 4,
              total: 100,
              date: '2026-07-15',
              entity: 'tax-other',
            },
            {
              id: 'business-unassigned',
              person: 'Acme Unassigned Customer',
              productId: 'business-box',
              quantity: 1,
              total: 7,
              date: '2026-08-11',
            },
          ],
    },
    '.docvault-mileage.json': {
      vehicles: empty
        ? []
        : [
            {
              id: 'business-car',
              name: 'Acme Demo Car',
              year: 2020,
              make: 'Acme',
              model: 'Tourer',
            },
            {
              id: 'business-van',
              name: 'Acme Demo Van',
              year: 2021,
              make: 'Acme',
              model: 'Carrier',
            },
          ],
      irsRate: 0.5,
      savedAddresses: empty
        ? []
        : [
            {
              id: 'business-alpha',
              label: 'Acme Alpha',
              formatted: 'Acme Location Alpha',
              lat: 0,
              lon: 0,
            },
            {
              id: 'business-beta',
              label: 'Acme Beta',
              formatted: 'Acme Location Beta',
              lat: 1,
              lon: 1,
            },
          ],
      entries: empty
        ? []
        : [
            {
              id: 'business-trip1',
              date: '2026-01-12',
              vehicleId: 'business-car',
              tripMiles: 50,
              odometerStart: 1000,
              odometerEnd: 1050,
              gallons: 2,
              totalCost: 7,
              purpose: 'Acme supply run',
              entity: 'acme',
            },
            {
              id: 'business-trip2',
              date: '2026-09-18',
              vehicleId: 'business-van',
              tripMiles: 80,
              gallons: 4,
              totalCost: 14,
              purpose: 'Acme delivery',
              entity: 'acme',
            },
            {
              id: 'business-fuel',
              date: '2026-09-20',
              vehicleId: 'business-car',
              gallons: 5,
              totalCost: 17.5,
              purpose: 'Fuel only',
              entity: 'acme',
            },
            {
              id: 'business-zero-trip',
              date: '2026-09-21',
              vehicleId: 'business-car',
              tripMiles: 0,
              purpose: 'Known zero distance',
              entity: 'acme',
            },
            {
              id: 'business-old-trip',
              date: '2025-05-10',
              vehicleId: 'business-car',
              tripMiles: 20,
              purpose: 'Prior-year journey',
              entity: 'acme',
            },
            {
              id: 'business-other-trip',
              date: '2026-06-10',
              vehicleId: 'business-van',
              tripMiles: 100,
              purpose: 'Other entity journey',
              entity: 'tax-other',
            },
          ],
    },
  };
  for (const [name, value] of Object.entries(files))
    await writeFile(path.join(dataDir, name), JSON.stringify(value));
}

// Provider transport is simulated; requests still pass through the real server handlers.
export function syntheticGeocode(url: URL): Response {
  if (url.pathname.endsWith('/autocomplete')) {
    const text = url.searchParams.get('text')?.toLowerCase() ?? '';
    if (text.includes('failure')) throw new Error('Synthetic address-provider failure');
    return Response.json({
      results: text.includes('empty')
        ? []
        : [{ formatted: 'Acme Search Location', lat: 2, lon: 2 }],
    });
  }
  const waypoints = url.searchParams.get('waypoints') ?? '';
  return Response.json({
    features: waypoints.startsWith('87,') ? [] : [{ properties: { distance: 8046.7 } }],
  });
}
