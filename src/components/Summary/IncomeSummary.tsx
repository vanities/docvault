import { FileText, DollarSign, Building, Download, Egg, ArrowRight } from 'lucide-react';
import { CopyableField } from './CopyableField';
import type {
  IncomeSummary as IncomeSummaryType,
  TaxDocument,
  ParsedW2,
  Parsed1099,
  ParsedK1,
  ParsedComposite1099,
} from '../../types';
import { DOCUMENT_TYPES } from '../../config';

interface IncomeSummaryProps {
  summary: IncomeSummaryType;
  documents: TaxDocument[];
  onDownload?: () => void;
  onNavigateToSales?: () => void;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(amount);
}

export function IncomeSummary({ summary, documents, onDownload, onNavigateToSales }: IncomeSummaryProps) {
  const w2Docs = documents.filter((d) => d.type === 'w2');
  const income1099Docs = documents.filter((d) => d.type.startsWith('1099'));
  const k1Docs = documents.filter((d) => d.type === 'k-1');

  // Group 1099s by type
  const income1099ByType = income1099Docs.reduce(
    (acc, doc) => {
      if (!acc[doc.type]) acc[doc.type] = [];
      acc[doc.type].push(doc);
      return acc;
    },
    {} as Record<string, TaxDocument[]>
  );

  return (
    <div className="space-y-6">
      {/* Header with download */}
      {onDownload && documents.length > 0 && (
        <div className="flex justify-end">
          <button
            onClick={onDownload}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium text-surface-700 hover:text-surface-950 bg-surface-200/50 hover:bg-surface-200 border border-border rounded-lg transition-colors"
          >
            <Download className="w-4 h-4" />
            Download Income Docs
          </button>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="glass-card rounded-xl p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-emerald-500/10 rounded-lg">
              <DollarSign className="w-5 h-5 text-emerald-400" />
            </div>
            <h3 className="font-semibold text-surface-950 text-[13px]">Total Income</h3>
          </div>
          <p className="text-3xl font-bold text-surface-950 font-mono tracking-tight">
            {formatCurrency(summary.totalIncome)}
          </p>
          <p className="text-[11px] text-surface-600 mt-1">For Tax Year {summary.taxYear}</p>
        </div>

        <div className="glass-card rounded-xl p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-info-500/10 rounded-lg">
              <Building className="w-5 h-5 text-info-400" />
            </div>
            <h3 className="font-semibold text-surface-950 text-[13px]">Federal Withheld</h3>
          </div>
          <p className="text-3xl font-bold text-surface-950 font-mono tracking-tight">
            {formatCurrency(summary.federalWithheld)}
          </p>
          <p className="text-[11px] text-surface-600 mt-1">From all sources</p>
        </div>

        <div className="glass-card rounded-xl p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-purple-500/10 rounded-lg">
              <FileText className="w-5 h-5 text-purple-400" />
            </div>
            <h3 className="font-semibold text-surface-950 text-[13px]">Documents</h3>
          </div>
          <p className="text-3xl font-bold text-surface-950 font-mono tracking-tight">
            {documents.length}
          </p>
          <p className="text-[11px] text-surface-600 mt-1">
            {summary.w2Count} W-2s, {summary.income1099Count} 1099s
            {summary.k1Count > 0 ? `, ${summary.k1Count} K-1s` : ''}
            {summary.salesCount > 0 ? `, ${summary.salesCount} sales` : ''}
          </p>
        </div>
      </div>

      {/* Copyable Summary Fields */}
      <div className="glass-card rounded-xl p-5">
        <h3 className="font-semibold text-surface-950 mb-4 text-[14px]">TurboTax Entry Values</h3>
        <p className="text-[13px] text-surface-600 mb-4">
          Click any value to copy for easy pasting into TurboTax.
        </p>

        <div className="space-y-2">
          <CopyableField
            label="Total W-2 Wages"
            value={summary.w2Total}
            sublabel="Box 1 total from all W-2s"
          />
          <CopyableField
            label="Total 1099 Income"
            value={summary.income1099Total}
            sublabel="All 1099 forms combined"
          />
          {summary.k1Total > 0 && (
            <CopyableField
              label="Total K-1 Income"
              value={summary.k1Total}
              sublabel="Ordinary income + guaranteed payments from K-1s"
            />
          )}
          {summary.salesTotal > 0 && (
            <CopyableField
              label="Sales Revenue"
              value={summary.salesTotal}
              sublabel="Business sales income (Schedule C)"
            />
          )}
          <CopyableField
            label="Federal Tax Withheld"
            value={summary.federalWithheld}
            sublabel="W-2 Box 2 + 1099 witholdings"
          />
          <CopyableField
            label="State Tax Withheld"
            value={summary.stateWithheld}
            sublabel="W-2 Box 17 + 1099 state"
          />
          <CopyableField
            label="Total Gross Income"
            value={summary.totalIncome}
            sublabel="All income sources (excludes capital gains)"
          />
          {summary.capitalGainsTotal !== 0 && (
            <>
              <div className="border-t border-border my-3" />
              <CopyableField
                label="Net Capital Gains (Schedule D)"
                value={summary.capitalGainsTotal}
                sublabel="From 1099-B / composite statements"
              />
              {summary.capitalGainsShortTerm !== 0 && (
                <CopyableField
                  label="Short-Term Capital Gains"
                  value={summary.capitalGainsShortTerm}
                  sublabel="Held < 1 year — taxed as ordinary income"
                />
              )}
              {summary.capitalGainsLongTerm !== 0 && (
                <CopyableField
                  label="Long-Term Capital Gains"
                  value={summary.capitalGainsLongTerm}
                  sublabel="Held > 1 year — preferential tax rate"
                />
              )}
            </>
          )}
        </div>
      </div>

      {/* W-2 Details */}
      {w2Docs.length > 0 && (
        <div className="glass-card rounded-xl p-5">
          <h3 className="font-semibold text-surface-950 mb-4 text-[14px]">
            W-2 Forms ({w2Docs.length})
          </h3>

          <div className="space-y-4">
            {w2Docs.map((doc) => {
              const data = doc.parsedData as ParsedW2 | undefined;

              return (
                <div key={doc.id} className="border border-border rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="font-medium text-surface-950 text-[13px]">
                        {data?.employer || doc.fileName}
                      </p>
                      {data?.ein && <p className="text-[11px] text-surface-600">EIN: {data.ein}</p>}
                    </div>
                    <span className="px-2 py-1 bg-emerald-500/15 text-emerald-400 text-[11px] font-medium rounded-md">
                      W-2
                    </span>
                  </div>

                  {data ? (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div>
                        <p className="text-[11px] text-surface-600">Box 1: Wages</p>
                        <p className="font-medium text-surface-950 font-mono text-[13px]">
                          {formatCurrency(data.wages)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] text-surface-600">Box 2: Fed Withheld</p>
                        <p className="font-medium text-surface-950 font-mono text-[13px]">
                          {formatCurrency(data.federalWithheld)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] text-surface-600">Box 3: SS Wages</p>
                        <p className="font-medium text-surface-950 font-mono text-[13px]">
                          {formatCurrency(data.socialSecurityWages)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] text-surface-600">Box 5: Medicare</p>
                        <p className="font-medium text-surface-950 font-mono text-[13px]">
                          {formatCurrency(data.medicareWages)}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-[13px] text-surface-600 italic">
                      No parsed data - click Edit to add details
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 1099 Details */}
      {Object.entries(income1099ByType).map(([type, docs]) => (
        <div key={type} className="glass-card rounded-xl p-5">
          <h3 className="font-semibold text-surface-950 mb-4 text-[14px]">
            {DOCUMENT_TYPES.find((dt) => dt.id === type)?.label || type} Forms ({docs.length})
          </h3>

          <div className="space-y-4">
            {docs.map((doc) => {
              if (doc.type === '1099-composite') {
                const data = doc.parsedData as ParsedComposite1099 | undefined;
                return (
                  <div key={doc.id} className="border border-border rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <p className="font-medium text-surface-950 text-[13px]">
                          {data?.payer || doc.fileName}
                        </p>
                        {data?.accountNumber && (
                          <p className="text-[11px] text-surface-600">
                            Account: {data.accountNumber}
                          </p>
                        )}
                      </div>
                      <span className="px-2 py-1 bg-purple-500/15 text-purple-400 text-[11px] font-medium rounded-md">
                        Composite 1099
                      </span>
                    </div>

                    {data ? (
                      <div className="space-y-3">
                        {/* DIV sub-form */}
                        {data.div && (data.div.ordinaryDividends || 0) > 0 && (
                          <div>
                            <p className="text-[11px] font-semibold text-surface-700 uppercase tracking-wider mb-1">
                              1099-DIV
                            </p>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                              {data.div.ordinaryDividends !== undefined && (
                                <div>
                                  <p className="text-[11px] text-surface-600">Ordinary Dividends</p>
                                  <p className="font-medium text-surface-950 font-mono text-[13px]">
                                    {formatCurrency(data.div.ordinaryDividends)}
                                  </p>
                                </div>
                              )}
                              {data.div.qualifiedDividends !== undefined &&
                                data.div.qualifiedDividends > 0 && (
                                  <div>
                                    <p className="text-[11px] text-surface-600">
                                      Qualified Dividends
                                    </p>
                                    <p className="font-medium text-surface-950 font-mono text-[13px]">
                                      {formatCurrency(data.div.qualifiedDividends)}
                                    </p>
                                  </div>
                                )}
                              {data.div.foreignTaxPaid !== undefined &&
                                data.div.foreignTaxPaid > 0 && (
                                  <div>
                                    <p className="text-[11px] text-surface-600">Foreign Tax Paid</p>
                                    <p className="font-medium text-surface-950 font-mono text-[13px]">
                                      {formatCurrency(data.div.foreignTaxPaid)}
                                    </p>
                                  </div>
                                )}
                              {data.div.federalWithheld !== undefined &&
                                data.div.federalWithheld > 0 && (
                                  <div>
                                    <p className="text-[11px] text-surface-600">Fed Withheld</p>
                                    <p className="font-medium text-surface-950 font-mono text-[13px]">
                                      {formatCurrency(data.div.federalWithheld)}
                                    </p>
                                  </div>
                                )}
                            </div>
                          </div>
                        )}

                        {/* B sub-form (capital gains) */}
                        {data.b &&
                          (data.b.totalGainLoss ||
                            data.b.shortTermGainLoss ||
                            data.b.longTermGainLoss) && (
                            <div>
                              <p className="text-[11px] font-semibold text-surface-700 uppercase tracking-wider mb-1">
                                1099-B (Capital Gains)
                              </p>
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                {data.b.shortTermGainLoss !== undefined && (
                                  <div>
                                    <p className="text-[11px] text-surface-600">
                                      Short-Term Gain/Loss
                                    </p>
                                    <p
                                      className={`font-medium font-mono text-[13px] ${(data.b.shortTermGainLoss || 0) >= 0 ? 'text-emerald-500' : 'text-red-400'}`}
                                    >
                                      {formatCurrency(data.b.shortTermGainLoss)}
                                    </p>
                                  </div>
                                )}
                                {data.b.longTermGainLoss !== undefined && (
                                  <div>
                                    <p className="text-[11px] text-surface-600">
                                      Long-Term Gain/Loss
                                    </p>
                                    <p
                                      className={`font-medium font-mono text-[13px] ${(data.b.longTermGainLoss || 0) >= 0 ? 'text-emerald-500' : 'text-red-400'}`}
                                    >
                                      {formatCurrency(data.b.longTermGainLoss)}
                                    </p>
                                  </div>
                                )}
                                {data.b.totalGainLoss !== undefined && (
                                  <div>
                                    <p className="text-[11px] text-surface-600">Total Gain/Loss</p>
                                    <p
                                      className={`font-medium font-mono text-[13px] ${(data.b.totalGainLoss || 0) >= 0 ? 'text-emerald-500' : 'text-red-400'}`}
                                    >
                                      {formatCurrency(data.b.totalGainLoss)}
                                    </p>
                                  </div>
                                )}
                                {data.b.totalProceeds !== undefined && data.b.totalProceeds > 0 && (
                                  <div>
                                    <p className="text-[11px] text-surface-600">Total Proceeds</p>
                                    <p className="font-medium text-surface-950 font-mono text-[13px]">
                                      {formatCurrency(data.b.totalProceeds)}
                                    </p>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}

                        {/* INT sub-form */}
                        {data.int && (data.int.interestIncome || 0) > 0 && (
                          <div>
                            <p className="text-[11px] font-semibold text-surface-700 uppercase tracking-wider mb-1">
                              1099-INT
                            </p>
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                              <div>
                                <p className="text-[11px] text-surface-600">Interest Income</p>
                                <p className="font-medium text-surface-950 font-mono text-[13px]">
                                  {formatCurrency(data.int.interestIncome!)}
                                </p>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Totals */}
                        {data.totalFederalWithheld !== undefined &&
                          data.totalFederalWithheld > 0 && (
                            <div className="border-t border-border pt-2">
                              <div className="grid grid-cols-2 gap-3">
                                <div>
                                  <p className="text-[11px] text-surface-600">
                                    Total Federal Withheld
                                  </p>
                                  <p className="font-medium text-surface-950 font-mono text-[13px]">
                                    {formatCurrency(data.totalFederalWithheld)}
                                  </p>
                                </div>
                              </div>
                            </div>
                          )}
                      </div>
                    ) : (
                      <p className="text-[13px] text-surface-600 italic">
                        No parsed data - click Edit to add details
                      </p>
                    )}
                  </div>
                );
              }

              // Standard 1099 rendering
              const data = doc.parsedData as Parsed1099 | undefined;
              return (
                <div key={doc.id} className="border border-border rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="font-medium text-surface-950 text-[13px]">
                        {data?.payer || doc.fileName}
                      </p>
                      {data?.payerTin && (
                        <p className="text-[11px] text-surface-600">TIN: {data.payerTin}</p>
                      )}
                    </div>
                    <span className="px-2 py-1 bg-info-500/15 text-info-400 text-[11px] font-medium rounded-md">
                      {DOCUMENT_TYPES.find((dt) => dt.id === type)?.label || type}
                    </span>
                  </div>

                  {data ? (
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      <div>
                        <p className="text-[11px] text-surface-600">Amount</p>
                        <p className="font-medium text-surface-950 font-mono text-[13px]">
                          {formatCurrency(
                            ((data as unknown as Record<string, unknown>)
                              .nonemployeeCompensation as number) ??
                              ((data as unknown as Record<string, unknown>)
                                .ordinaryDividends as number) ??
                              ((data as unknown as Record<string, unknown>)
                                .interestIncome as number) ??
                              data.amount ??
                              0
                          )}
                        </p>
                      </div>
                      {data.federalWithheld !== undefined && data.federalWithheld > 0 && (
                        <div>
                          <p className="text-[11px] text-surface-600">Fed Withheld</p>
                          <p className="font-medium text-surface-950 font-mono text-[13px]">
                            {formatCurrency(data.federalWithheld)}
                          </p>
                        </div>
                      )}
                      {data.accountNumber && (
                        <div>
                          <p className="text-[11px] text-surface-600">Account</p>
                          <p className="font-medium text-surface-950 font-mono text-[13px]">
                            {data.accountNumber}
                          </p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-[13px] text-surface-600 italic">
                      No parsed data - click Edit to add details
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* Sales Income */}
      {summary.salesTotal > 0 && (
        <div className="glass-card rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-surface-950 text-[14px]">
              Sales Revenue ({summary.salesCount} sales)
            </h3>
            {onNavigateToSales && (
              <button
                onClick={onNavigateToSales}
                className="flex items-center gap-1.5 text-[13px] font-medium text-amber-500 hover:text-amber-400 transition-colors"
              >
                <Egg className="w-4 h-4" />
                View Sales
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="border border-border rounded-lg p-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-[11px] text-surface-600">Total Sales Revenue</p>
                <p className="font-medium text-surface-950 font-mono text-[13px]">
                  {formatCurrency(summary.salesTotal)}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-surface-600">Number of Sales</p>
                <p className="font-medium text-surface-950 font-mono text-[13px]">
                  {summary.salesCount}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* K-1 Details */}
      {k1Docs.length > 0 && (
        <div className="glass-card rounded-xl p-5">
          <h3 className="font-semibold text-surface-950 mb-4 text-[14px]">
            Schedule K-1 Forms ({k1Docs.length})
          </h3>

          <div className="space-y-4">
            {k1Docs.map((doc) => {
              const data = doc.parsedData as ParsedK1 | undefined;

              return (
                <div key={doc.id} className="border border-border rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="font-medium text-surface-950 text-[13px]">
                        {data?.entityName || doc.fileName}
                      </p>
                      {data?.entityEin && (
                        <p className="text-[11px] text-surface-600">EIN: {data.entityEin}</p>
                      )}
                      {data?.formType && (
                        <p className="text-[11px] text-surface-600 capitalize">
                          {data.formType === 'partnership'
                            ? 'Partnership (1065)'
                            : data.formType === 's-corp'
                              ? 'S-Corp (1120-S)'
                              : 'Trust/Estate (1041)'}
                        </p>
                      )}
                    </div>
                    <span className="px-2 py-1 bg-amber-500/15 text-amber-400 text-[11px] font-medium rounded-md">
                      K-1
                    </span>
                  </div>

                  {data ? (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {data.ordinaryIncome !== undefined && (
                        <div>
                          <p className="text-[11px] text-surface-600">Box 1: Ordinary Income</p>
                          <p className="font-medium text-surface-950 font-mono text-[13px]">
                            {formatCurrency(data.ordinaryIncome)}
                          </p>
                        </div>
                      )}
                      {data.guaranteedPayments !== undefined && data.guaranteedPayments > 0 && (
                        <div>
                          <p className="text-[11px] text-surface-600">Box 4: Guaranteed Payments</p>
                          <p className="font-medium text-surface-950 font-mono text-[13px]">
                            {formatCurrency(data.guaranteedPayments)}
                          </p>
                        </div>
                      )}
                      {data.selfEmploymentEarnings !== undefined &&
                        data.selfEmploymentEarnings > 0 && (
                          <div>
                            <p className="text-[11px] text-surface-600">Box 14: SE Earnings</p>
                            <p className="font-medium text-surface-950 font-mono text-[13px]">
                              {formatCurrency(data.selfEmploymentEarnings)}
                            </p>
                          </div>
                        )}
                      {data.distributions !== undefined && data.distributions > 0 && (
                        <div>
                          <p className="text-[11px] text-surface-600">Box 19: Distributions</p>
                          <p className="font-medium text-surface-950 font-mono text-[13px]">
                            {formatCurrency(data.distributions)}
                          </p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-[13px] text-surface-600 italic">
                      No parsed data - click Edit to add details
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Empty State */}
      {documents.length === 0 && (
        <div className="glass-card rounded-xl p-8 text-center">
          <FileText className="w-12 h-12 text-surface-500 mx-auto mb-4" />
          <h3 className="font-medium text-surface-900 mb-1">No income documents</h3>
          <p className="text-[13px] text-surface-600">
            Upload your W-2s and 1099s to see your income summary.
          </p>
        </div>
      )}
    </div>
  );
}
