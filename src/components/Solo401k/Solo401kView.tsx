import { useAppContext } from '../../contexts/AppContext';
import { useAnalytics } from '../../hooks/useAnalytics';
import { Solo401kCalculator } from '../Dashboard/Solo401kCalculator';

export function Solo401kView() {
  const { selectedYear } = useAppContext();
  // Solo 401(k) always uses "all" entity analytics — the IRS worksheet
  // combines ALL self-employment income (Schedule C + K-1 SE earnings)
  const analytics = useAnalytics('all', selectedYear);

  // Use revenue deposits (excludes owner contributions) for gross SE income
  const defaultGross =
    analytics.bankDepositSummary && analytics.bankDepositSummary.totalRevenue > 0
      ? analytics.bankDepositSummary.totalRevenue
      : analytics.bankDepositSummary && analytics.bankDepositSummary.totalDeposits > 0
        ? analytics.bankDepositSummary.totalDeposits
        : analytics.invoiceSummary.invoiceTotal;

  // Extract K-1 SE earnings from income items (IRS Pub 560 Step 1 includes these)
  const k1SEEarnings = analytics.incomeItems
    .filter((item) => item.type === 'K-1' && item.details?.selfEmploymentEarnings)
    .reduce((sum, item) => sum + (item.details!.selfEmploymentEarnings as number), 0);

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <Solo401kCalculator
        defaultGross={defaultGross}
        defaultExpenses={analytics.expenseSummary.totalDeductible}
        k1SEEarnings={k1SEEarnings}
        taxYear={selectedYear}
        entity="all"
      />
    </div>
  );
}
