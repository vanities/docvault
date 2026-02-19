import { FileText, DollarSign, Building, Download } from 'lucide-react';
import { CopyableField } from './CopyableField';
import type {
  IncomeSummary as IncomeSummaryType,
  TaxDocument,
  ParsedW2,
  Parsed1099,
} from '../../types';
import { DOCUMENT_TYPES } from '../../config';

interface IncomeSummaryProps {
  summary: IncomeSummaryType;
  documents: TaxDocument[];
  onDownload?: () => void;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
  }).format(amount);
}

export function IncomeSummary({ summary, documents, onDownload }: IncomeSummaryProps) {
  const w2Docs = documents.filter((d) => d.type === 'w2');
  const income1099Docs = documents.filter((d) => d.type.startsWith('1099'));

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
            sublabel="All income sources"
          />
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
                          {formatCurrency(data.amount)}
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
