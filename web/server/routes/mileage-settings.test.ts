// Fabricated store only. No household records or filesystem reads.
import { beforeEach, expect, test, vi } from 'vite-plus/test';
import { handleMileageRoutes } from './mileage.js';
import { loadMileageData, saveMileageData } from '../data.js';

vi.mock('../data.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data.js')>()),
  loadMileageData: vi.fn(),
  saveMileageData: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(saveMileageData).mockResolvedValue(undefined);
});

async function update(path: string, body: unknown) {
  const url = new URL('http://internal' + path);
  return (await handleMileageRoutes(
    new Request(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    url,
    url.pathname
  ))!;
}

test('settings update changes the rate without requiring a trip named settings', async () => {
  vi.mocked(loadMileageData).mockResolvedValue({ vehicles: [], entries: [], irsRate: 0.5 });
  const response = await update('/api/mileage/settings', { irsRate: 0.6 });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
  expect(saveMileageData).toHaveBeenCalledWith({ vehicles: [], entries: [], irsRate: 0.6 });
});

test('normal trip updates still clear optional observations without changing the rate', async () => {
  const data = {
    vehicles: [],
    irsRate: 0.5,
    entries: [
      {
        id: 'acme-trip',
        vehicleId: 'acme-car',
        date: '2026-01-01',
        tripMiles: 10,
        gallons: 2,
        createdAt: '2026-01-01T00:00:00Z',
      },
    ],
  };
  vi.mocked(loadMileageData).mockResolvedValue(data);
  const response = await update('/api/mileage/acme-trip', {
    tripMiles: '',
    gallons: '',
    totalCost: 0,
  });
  expect(response.status).toBe(200);
  const { entry } = await response.json();
  expect(entry.tripMiles).toBeUndefined();
  expect(entry.gallons).toBeUndefined();
  expect(entry.totalCost).toBe(0);
  expect(data.irsRate).toBe(0.5);
});
