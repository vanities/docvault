// Unit tests for 401k contributions API routes.

import { expect, test, describe, vi, beforeEach } from 'vite-plus/test';
import { handleMiscRoutes } from './misc.js';

// Mock the data layer so tests don't touch disk
vi.mock('../data.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../data.js')>();
  return {
    ...actual,
    loadContributions: vi.fn(),
    saveContributions: vi.fn(),
  };
});

import { loadContributions, saveContributions } from '../data.js';

const mockLoad = vi.mocked(loadContributions);
const mockSave = vi.mocked(saveContributions);

function makeReq(method: string, path: string, body?: unknown): [Request, URL, string] {
  const url = new URL(`http://localhost:3005${path}`);
  const init: RequestInit = { method };
  if (body) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  return [new Request(url, init), url, url.pathname];
}

const SAMPLE_DATA = {
  'consulting-llc/2025': [
    { id: '1', date: '2025-12-01', amount: 23500, type: 'employee' as const },
    { id: '2', date: '2025-12-01', amount: 15000, type: 'employer' as const },
    { id: '3', date: '2026-03-07', amount: 11171, type: 'employer' as const },
  ],
  'farm-llc/2025': [{ id: '4', date: '2025-11-15', amount: 5000, type: 'employee' as const }],
  'personal/2025': [],
  'all/2025': [],
  'consulting-llc/2024': [
    { id: '5', date: '2024-06-01', amount: 10000, type: 'employee' as const },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockLoad.mockResolvedValue(structuredClone(SAMPLE_DATA));
  mockSave.mockResolvedValue(undefined);
});

describe('GET /api/contributions/:entity/:year', () => {
  test('returns contributions for a specific entity', async () => {
    const resp = await handleMiscRoutes(
      ...makeReq('GET', '/api/contributions/consulting-llc/2025')
    );
    expect(resp).not.toBeNull();
    const data = await resp!.json();
    expect(data.contributions).toHaveLength(3);
    expect(data.contributions[0].amount).toBe(23500);
  });

  test('returns empty array for entity with no contributions', async () => {
    const resp = await handleMiscRoutes(...makeReq('GET', '/api/contributions/personal/2025'));
    const data = await resp!.json();
    expect(data.contributions).toEqual([]);
  });

  test('returns empty array for unknown entity', async () => {
    const resp = await handleMiscRoutes(...makeReq('GET', '/api/contributions/unknown-llc/2025'));
    const data = await resp!.json();
    expect(data.contributions).toEqual([]);
  });

  test('aggregates all entities when entity is "all"', async () => {
    const resp = await handleMiscRoutes(...makeReq('GET', '/api/contributions/all/2025'));
    const data = await resp!.json();
    // Should include consulting-llc (3) + farm-llc (1) but NOT all/2025 or personal/2025 (empty)
    expect(data.contributions).toHaveLength(4);
  });

  test('"all" aggregation includes the person-level "all" key', async () => {
    // The all/<year> key is the canonical person ledger — it merges in.
    mockLoad.mockResolvedValue({
      ...structuredClone(SAMPLE_DATA),
      'all/2025': [{ id: 'plan-row', date: '2025-01-01', amount: 999, type: 'employee' }],
    });
    const resp = await handleMiscRoutes(...makeReq('GET', '/api/contributions/all/2025'));
    const data = await resp!.json();
    expect(data.contributions.find((c: { id: string }) => c.id === 'plan-row')).toBeDefined();
    // 4 legacy per-entity rows + 1 person-level row
    expect(data.contributions).toHaveLength(5);
  });

  test('"all" aggregation is sorted by date', async () => {
    const resp = await handleMiscRoutes(...makeReq('GET', '/api/contributions/all/2025'));
    const data = await resp!.json();
    const dates = data.contributions.map((c: { date: string }) => c.date);
    expect(dates).toEqual([...dates].sort());
  });

  test('"all" aggregation only includes the requested year', async () => {
    const resp = await handleMiscRoutes(...makeReq('GET', '/api/contributions/all/2024'));
    const data = await resp!.json();
    // Only consulting-llc/2024 has data for 2024
    expect(data.contributions).toHaveLength(1);
    expect(data.contributions[0].amount).toBe(10000);
  });
});

describe('PUT /api/contributions/:entity/:year', () => {
  test('saves contributions for a specific entity', async () => {
    const newContribs = [{ id: '10', date: '2025-06-01', amount: 5000, type: 'employee' }];
    const resp = await handleMiscRoutes(
      ...makeReq('PUT', '/api/contributions/consulting-llc/2025', { contributions: newContribs })
    );
    const data = await resp!.json();
    expect(data.ok).toBe(true);
    expect(mockSave).toHaveBeenCalledOnce();
    const savedData = mockSave.mock.calls[0][0];
    expect(savedData['consulting-llc/2025']).toEqual(newContribs);
  });

  test('"all" PUT consolidates the year into the person-level key', async () => {
    // The submitted list is the whole merged ledger, so legacy per-entity
    // rows for that year are absorbed into all/<year> — not duplicated.
    const merged = [
      { id: '1', date: '2025-12-01', amount: 23500, type: 'employee' },
      { id: 'x', date: '2025-01-01', amount: 100, type: 'employee' },
    ];
    const resp = await handleMiscRoutes(
      ...makeReq('PUT', '/api/contributions/all/2025', { contributions: merged })
    );
    const data = await resp!.json();
    expect(data.ok).toBe(true);
    expect(mockSave).toHaveBeenCalledOnce();
    const saved = mockSave.mock.calls[0][0];
    expect(saved['all/2025']).toEqual(merged);
    expect(saved['consulting-llc/2025']).toBeUndefined();
    expect(saved['farm-llc/2025']).toBeUndefined();
    // Other years are untouched
    expect(saved['consulting-llc/2024']).toBeDefined();
  });

  test('rejects non-array contributions', async () => {
    const resp = await handleMiscRoutes(
      ...makeReq('PUT', '/api/contributions/consulting-llc/2025', { contributions: 'not-array' })
    );
    expect(resp!.status).toBe(400);
    const data = await resp!.json();
    expect(data.error).toMatch(/array/);
  });
});
