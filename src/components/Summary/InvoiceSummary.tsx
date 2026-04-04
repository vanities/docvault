import { useState } from 'react';
import { FileText, DollarSign, Users, ChevronDown, ChevronRight, Download } from 'lucide-react';
import { CopyableField } from './CopyableField';
import type { InvoiceSummaryData, TaxDocument } from '../../types';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Money } from '../common/Money';

interface InvoiceSummaryProps {
  summary: InvoiceSummaryData;
  documents: TaxDocument[];
  onDownload?: () => void;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(amount);
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

/** Extract customer/vendor name from a TaxDocument */
function getInvoiceCustomer(doc: TaxDocument): string {
  const data = doc.parsedData as Record<string, unknown> | undefined;
  if (data) {
    if (typeof data.billTo === 'string' && data.billTo) return data.billTo;
    if (typeof data.customerName === 'string' && data.customerName) return data.customerName;
    if (typeof data.vendor === 'string' && data.vendor) return data.vendor;
  }
  // Fall back to filename: {Source}_{Type}_{Date}.ext → take Source
  return extractVendorFromFilename(doc.fileName);
}

/** Extract vendor/source from standardized filename */
function extractVendorFromFilename(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, ''); // strip extension
  const parts = base.split('_');
  if (parts.length >= 3) {
    // Find the type keyword index
    const typeKeywords = ['invoice', 'Invoice', 'receipt', 'w2', 'W2', '1099'];
    const typeIdx = parts.findIndex((p) =>
      typeKeywords.some((kw) => p.toLowerCase() === kw.toLowerCase())
    );
    if (typeIdx > 0) {
      return parts.slice(0, typeIdx).join(' ');
    }
  }
  return parts[0] || 'Unknown';
}

function CustomerSection({ customer, docs }: { customer: string; docs: TaxDocument[] }) {
  const [expanded, setExpanded] = useState(false);

  const total = docs.reduce((sum, doc) => {
    const data = doc.parsedData as Record<string, unknown> | undefined;
    if (!data) return sum;
    const amount =
      typeof data.totalAmount === 'number'
        ? data.totalAmount
        : typeof data.amount === 'number'
          ? data.amount
          : typeof data.total === 'number'
            ? data.total
            : typeof data.subtotal === 'number'
              ? data.subtotal
              : 0;
    return sum + amount;
  }, 0);

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <Button
        variant="ghost"
        onClick={() => setExpanded(!expanded)}
        className="w-full bg-surface-200/30 px-4 py-3 flex items-center justify-between hover:bg-surface-200/50 h-auto rounded-none"
      >
        <div className="flex items-center gap-2">
          {expanded ? (
            <ChevronDown className="w-4 h-4 text-surface-600" />
          ) : (
            <ChevronRight className="w-4 h-4 text-surface-600" />
          )}
          <div className="text-left">
            <p className="font-medium text-surface-950 text-[13px]">{customer}</p>
            <p className="text-[11px] text-surface-600">
              {docs.length} invoice{docs.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <p className="font-semibold text-surface-950 font-mono text-[13px]">
          <Money>{formatCurrency(total)}</Money>
        </p>
      </Button>

      {expanded && (
        <div className="divide-y divide-border">
          {docs.map((doc) => {
            const data = doc.parsedData as Record<string, unknown> | undefined;
            const amount =
              data && typeof data.totalAmount === 'number'
                ? data.totalAmount
                : data && typeof data.amount === 'number'
                  ? data.amount
                  : data && typeof data.total === 'number'
                    ? data.total
                    : data && typeof data.subtotal === 'number'
                      ? data.subtotal
                      : null;
            const invoiceNum =
              data && typeof data.invoiceNumber === 'string' ? data.invoiceNumber : null;

            return (
              <div key={doc.id} className="px-4 py-2 flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] text-surface-800 truncate">{doc.fileName}</p>
                  <p className="text-[11px] text-surface-600">
                    {data && typeof data.invoiceDate === 'string'
                      ? formatDate(data.invoiceDate)
                      : data && typeof data.date === 'string'
                        ? formatDate(data.date)
                        : formatDate(doc.createdAt)}
                    {invoiceNum && ` · #${invoiceNum}`}
                  </p>
                </div>
                <p className="text-[13px] font-medium text-surface-950 ml-4 font-mono">
                  {amount !== null ? <Money>{formatCurrency(amount)}</Money> : '-'}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function InvoiceSummary({ summary, documents, onDownload }: InvoiceSummaryProps) {
  // Group documents by customer
  const docsByCustomer = new Map<string, TaxDocument[]>();
  for (const doc of documents) {
    const customer = getInvoiceCustomer(doc);
    const existing = docsByCustomer.get(customer) || [];
    existing.push(doc);
    docsByCustomer.set(customer, existing);
  }

  // Sort groups by total descending
  const sortedCustomers = Array.from(docsByCustomer.entries()).sort((a, b) => {
    const totalA = a[1].reduce((sum, doc) => {
      const data = doc.parsedData as Record<string, unknown> | undefined;
      return (
        sum +
        (typeof data?.totalAmount === 'number'
          ? data.totalAmount
          : typeof data?.amount === 'number'
            ? data.amount
            : typeof data?.total === 'number'
              ? data.total
              : typeof data?.subtotal === 'number'
                ? data.subtotal
                : 0)
      );
    }, 0);
    const totalB = b[1].reduce((sum, doc) => {
      const data = doc.parsedData as Record<string, unknown> | undefined;
      return (
        sum +
        (typeof data?.totalAmount === 'number'
          ? data.totalAmount
          : typeof data?.amount === 'number'
            ? data.amount
            : typeof data?.total === 'number'
              ? data.total
              : typeof data?.subtotal === 'number'
                ? data.subtotal
                : 0)
      );
    }, 0);
    return totalB - totalA;
  });

  return (
    <div className="space-y-6">
      {/* Header with download */}
      {onDownload && documents.length > 0 && (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={onDownload}>
            <Download className="w-4 h-4" />
            Download Invoices
          </Button>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card variant="glass" className="p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-emerald-500/10 rounded-lg">
              <DollarSign className="w-5 h-5 text-emerald-400" />
            </div>
            <h3 className="font-semibold text-surface-950 text-[13px]">Total Invoiced</h3>
          </div>
          <p className="text-3xl font-bold text-surface-950 font-mono tracking-tight">
            <Money>{formatCurrency(summary.invoiceTotal)}</Money>
          </p>
          <p className="text-[11px] text-surface-600 mt-1">For Tax Year {summary.taxYear}</p>
        </Card>

        <Card variant="glass" className="p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-info-500/10 rounded-lg">
              <Users className="w-5 h-5 text-info-400" />
            </div>
            <h3 className="font-semibold text-surface-950 text-[13px]">Customers</h3>
          </div>
          <p className="text-3xl font-bold text-surface-950 font-mono tracking-tight">
            {summary.byCustomer.length}
          </p>
          <p className="text-[11px] text-surface-600 mt-1">Unique billing customers</p>
        </Card>

        <Card variant="glass" className="p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-purple-500/10 rounded-lg">
              <FileText className="w-5 h-5 text-purple-400" />
            </div>
            <h3 className="font-semibold text-surface-950 text-[13px]">Invoices</h3>
          </div>
          <p className="text-3xl font-bold text-surface-950 font-mono tracking-tight">
            {summary.invoiceCount}
          </p>
          <p className="text-[11px] text-surface-600 mt-1">Total invoice documents</p>
        </Card>
      </div>

      {/* Copyable Total */}
      {summary.invoiceTotal > 0 && (
        <Card variant="glass" className="p-5">
          <h3 className="font-semibold text-surface-950 mb-4 text-[14px]">
            Invoice Total for TurboTax
          </h3>
          <div className="space-y-2">
            <CopyableField
              label="Total Invoiced Revenue"
              value={summary.invoiceTotal}
              sublabel={`${summary.invoiceCount} invoices from ${summary.byCustomer.length} customers`}
            />
            {summary.byCustomer.map((group) => (
              <CopyableField
                key={group.customer}
                label={group.customer}
                value={group.total}
                sublabel={`${group.count} invoice${group.count !== 1 ? 's' : ''}`}
              />
            ))}
          </div>
        </Card>
      )}

      {/* Customer Breakdown */}
      {sortedCustomers.length > 0 && (
        <Card variant="glass" className="p-5">
          <h3 className="font-semibold text-surface-950 mb-4 text-[14px]">By Customer</h3>
          <div className="space-y-3">
            {sortedCustomers.map(([customer, docs]) => (
              <CustomerSection key={customer} customer={customer} docs={docs} />
            ))}
          </div>
        </Card>
      )}

      {/* Empty State */}
      {documents.length === 0 && (
        <Card variant="glass" className="p-8 text-center">
          <FileText className="w-12 h-12 text-surface-500 mx-auto mb-4" />
          <h3 className="font-medium text-surface-900 mb-1">No invoices</h3>
          <p className="text-[13px] text-surface-600">
            Upload your invoices to see revenue grouped by customer.
          </p>
        </Card>
      )}
    </div>
  );
}
