import { useAppContext } from '../../contexts/AppContext';
import { useAnalytics } from '../../hooks/useAnalytics';
import { Solo401kCalculator } from '../Dashboard/Solo401kCalculator';

export function Solo401kView() {
  const { selectedEntity, selectedYear } = useAppContext();
  const analytics = useAnalytics(selectedEntity, selectedYear);

  // Use revenue deposits (excludes owner contributions like Manna transfers)
  // to get accurate self-employment gross income for the 401(k) calculation
  const defaultGross =
    analytics.bankDepositSummary && analytics.bankDepositSummary.totalRevenue > 0
      ? analytics.bankDepositSummary.totalRevenue
      : analytics.bankDepositSummary && analytics.bankDepositSummary.totalDeposits > 0
        ? analytics.bankDepositSummary.totalDeposits
        : analytics.invoiceSummary.invoiceTotal;

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <Solo401kCalculator
        defaultGross={defaultGross}
        defaultExpenses={analytics.expenseSummary.totalDeductible}
        taxYear={selectedYear}
        entity={selectedEntity}
      />
    </div>
  );
}
