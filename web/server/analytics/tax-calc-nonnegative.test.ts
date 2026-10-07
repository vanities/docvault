import { expect, test } from 'vite-plus/test';
import { getTaxCalculation } from './tax-calc';

test('investment losses cannot make NIIT negative below or above the AGI threshold', () => {
  for (const wages of [42000, 400000]) {
    const result = getTaxCalculation(
      '2026',
      {
        synthetic: {
          income: [
            { source: 'Acme Employer', amount: wages, type: 'W-2' },
            {
              source: 'Acme Bank',
              amount: 175,
              type: '1099-INT',
              details: { interestIncome: 175 },
            },
            {
              source: 'Acme Broker',
              amount: -200,
              type: '1099-B',
              details: { shortTermGainLoss: -400, longTermGainLoss: 200 },
            },
          ],
        },
      },
      0
    );
    expect(result.niit).toBe(0);
    expect(result.estimatedTotalTax).toBe(result.estimatedIncomeTax + result.seTax);
  }
});

test('positive investment income retains the NIIT calculation', () => {
  const result = getTaxCalculation(
    '2026',
    {
      synthetic: {
        income: [
          { source: 'Acme Employer', amount: 400000, type: 'W-2' },
          {
            source: 'Acme Bank',
            amount: 10000,
            type: '1099-INT',
            details: { interestIncome: 10000 },
          },
        ],
      },
    },
    0
  );
  expect(result.niit).toBe(380);
});
