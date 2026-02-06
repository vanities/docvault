import { useState } from 'react';
import { Vault } from 'lucide-react';
import { EntitySwitcher } from './EntitySwitcher';
import { TaxYearSelector } from './TaxYearSelector';
import { QuickStats } from './QuickStats';
import { UploadZone } from '../Documents/UploadZone';
import { DocumentList } from '../Documents/DocumentList';
import { IncomeSummary } from '../Summary/IncomeSummary';
import { ExpenseSummary } from '../Summary/ExpenseSummary';
import { useDocuments } from '../../hooks/useDocuments';
import type { Entity } from '../../types';

type TabType = 'documents' | 'income' | 'expenses';

export function Dashboard() {
  const currentYear = new Date().getFullYear();
  const [selectedEntity, setSelectedEntity] = useState<Entity>('personal');
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [activeTab, setActiveTab] = useState<TabType>('documents');

  const {
    addDocument,
    updateDocument,
    deleteDocument,
    getFilteredDocuments,
    getIncomeSummary,
    getExpenseSummary,
    getAvailableTaxYears,
  } = useDocuments();

  const filteredDocuments = getFilteredDocuments(selectedEntity, selectedYear);
  const incomeSummary = getIncomeSummary(selectedEntity, selectedYear);
  const expenseSummary = getExpenseSummary(selectedEntity, selectedYear);
  const availableYears = getAvailableTaxYears();

  const tabs: { id: TabType; label: string }[] = [
    { id: 'documents', label: 'Documents' },
    { id: 'income', label: 'Income' },
    { id: 'expenses', label: 'Expenses' },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-600 rounded-lg">
                <Vault className="w-6 h-6 text-white" />
              </div>
              <h1 className="text-xl font-bold text-gray-900">TaxVault</h1>
            </div>
            <TaxYearSelector
              selectedYear={selectedYear}
              availableYears={availableYears}
              onYearChange={setSelectedYear}
            />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Entity Switcher */}
        <div className="mb-6">
          <EntitySwitcher selectedEntity={selectedEntity} onEntityChange={setSelectedEntity} />
        </div>

        {/* Quick Stats */}
        <div className="mb-6">
          <QuickStats
            incomeSummary={incomeSummary}
            expenseSummary={expenseSummary}
            documentCount={filteredDocuments.length}
          />
        </div>

        {/* Upload Zone */}
        <div className="mb-6">
          <UploadZone entity={selectedEntity} taxYear={selectedYear} onUpload={addDocument} />
        </div>

        {/* Tab Navigation */}
        <div className="border-b border-gray-200 mb-6">
          <nav className="flex gap-6">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`
                  pb-3 px-1 text-sm font-medium border-b-2 transition-colors
                  ${
                    activeTab === tab.id
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }
                `}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Tab Content */}
        {activeTab === 'documents' && (
          <DocumentList
            documents={filteredDocuments}
            onUpdate={updateDocument}
            onDelete={deleteDocument}
          />
        )}
        {activeTab === 'income' && (
          <IncomeSummary
            summary={incomeSummary}
            documents={filteredDocuments.filter(
              (d) => d.type === 'w2' || d.type.startsWith('1099')
            )}
          />
        )}
        {activeTab === 'expenses' && (
          <ExpenseSummary
            summary={expenseSummary}
            documents={filteredDocuments.filter((d) => d.type === 'receipt')}
          />
        )}
      </main>
    </div>
  );
}
