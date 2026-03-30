import { useMemo } from 'react';
import { useAppContext } from '../../contexts/AppContext';
import { useAnalytics } from '../../hooks/useAnalytics';
import { Solo401kCalculator } from '../Dashboard/Solo401kCalculator';

export function Solo401kView() {
  const { selectedYear, entities } = useAppContext();
  // "all" analytics gives us cross-entity data: per-entity bank deposits + K-1 items
  const allAnalytics = useAnalytics('all', selectedYear);

  // Find the SE entity — the one with revenue deposits (Schedule C business)
  const seEntity = useMemo(() => {
    let best = '';
    let bestRevenue = 0;
    for (const [entityId, deposits] of Object.entries(allAnalytics.bankDepositDetails)) {
      if (deposits.totalRevenue > bestRevenue) {
        bestRevenue = deposits.totalRevenue;
        best = entityId;
      }
    }
    return best;
  }, [allAnalytics.bankDepositDetails]);

  // Fetch the SE entity's analytics for accurate gross/expenses
  const seAnalytics = useAnalytics(seEntity || 'all', selectedYear);

  // Get home office deduction from SE entity's metadata
  const seEntityConfig = entities.find((e) => e.id === seEntity);
  const homeOfficeDeduction =
    parseFloat(seEntityConfig?.metadata?.homeOfficeDeduction as string) || 0;

  // Gross: SE entity's revenue deposits
  const defaultGross =
    seAnalytics.bankDepositSummary && seAnalytics.bankDepositSummary.totalRevenue > 0
      ? seAnalytics.bankDepositSummary.totalRevenue
      : seAnalytics.bankDepositSummary && seAnalytics.bankDepositSummary.totalDeposits > 0
        ? seAnalytics.bankDepositSummary.totalDeposits
        : seAnalytics.invoiceSummary.invoiceTotal;

  // Expenses: SE entity's deductible expenses + home office from metadata
  const defaultExpenses = seAnalytics.expenseSummary.totalDeductible + homeOfficeDeduction;

  // K-1 SE earnings: only count ONE K-1 per partnership (the primary filer's)
  const k1SEEarnings = useMemo(() => {
    const seenEntities = new Set<string>();
    let total = 0;
    for (const item of allAnalytics.incomeItems) {
      if (item.type !== 'K-1' || !item.details?.selfEmploymentEarnings) continue;
      const entityKey = item.source;
      if (seenEntities.has(entityKey)) continue;
      seenEntities.add(entityKey);
      total += item.details.selfEmploymentEarnings as number;
    }
    return total;
  }, [allAnalytics.incomeItems]);

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <Solo401kCalculator
        defaultGross={defaultGross}
        defaultExpenses={defaultExpenses}
        k1SEEarnings={k1SEEarnings}
        taxYear={selectedYear}
        entity="all"
      />
    </div>
  );
}
