// Fabricated settings only. The plan store is mocked: no filesystem reads or writes.
import { beforeEach, expect, test, vi } from 'vite-plus/test';
import { handleLiabilityRoutes } from './liabilities.js';
import { loadDebtPlan, saveDebtPlan } from '../data.js';
import { DEFAULT_DEBT_PLAN_SETTINGS } from '../debt-plan.js';

vi.mock('../data.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data.js')>()),
  loadDebtPlan: vi.fn(),
  saveDebtPlan: vi.fn(),
}));

const SAVED = { ...DEFAULT_DEBT_PLAN_SETTINGS, livingExpenses: 3000, extraMonthly: 250 };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadDebtPlan).mockResolvedValue({ ...SAVED });
  vi.mocked(saveDebtPlan).mockResolvedValue(undefined);
});

async function call(method: 'GET' | 'PUT', body?: unknown) {
  const url = new URL('http://internal/api/debt-plan');
  return (await handleLiabilityRoutes(
    new Request(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    url,
    url.pathname
  ))!;
}

test('GET returns the saved plan', async () => {
  const response = await call('GET');
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(SAVED);
});

test('PUT changes only the fields sent and stamps updatedAt', async () => {
  const response = await call('PUT', { livingExpenses: 4500, investments: null });
  expect(response.status).toBe(200);
  const { settings } = await response.json();
  expect(settings).toMatchObject({ ...SAVED, livingExpenses: 4500, investments: null });
  expect(typeof settings.updatedAt).toBe('string');
  expect(saveDebtPlan).toHaveBeenCalledWith(settings);
});

test('PUT with an invalid field is a 400 that names it and saves nothing', async () => {
  const response = await call('PUT', { livingExpenses: 4500, withdrawalRate: 2 });
  expect(response.status).toBe(400);
  expect((await response.json()).error).toContain('withdrawalRate');
  expect(saveDebtPlan).not.toHaveBeenCalled();
});

test('other liability paths still fall through to their own handlers', async () => {
  const url = new URL('http://internal/api/debt-plan/extra');
  expect(await handleLiabilityRoutes(new Request(url), url, url.pathname)).toBeNull();
});
