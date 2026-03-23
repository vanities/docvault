import { useState } from 'react';
import { Server, AlertCircle } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { useAppContext } from '../../contexts/AppContext';
import { TaxYearView } from '../TaxYear/TaxYearView';
import { BusinessDocsView } from '../BusinessDocs/BusinessDocsView';
import { AllFilesView } from '../AllFiles/AllFilesView';
import { SettingsView } from '../Settings/SettingsView';
import { TnTaxView } from '../TnTax/TnTaxView';
import { CryptoView } from '../Crypto/CryptoView';
import { BrokersView } from '../Brokers/BrokersView';
import { BanksView } from '../Banks/BanksView';
import { PortfolioView } from '../Portfolio/PortfolioView';
import { AddEntityModal } from '../Settings/AddEntityModal';
import { SearchResultsView } from '../Search/SearchResultsView';

export function Layout() {
  const {
    isConnected,
    checkConnection,
    fsError,
    activeView,
    searchActive,
    sidebarOpen,
    setSidebarOpen,
  } = useAppContext();
  const [showAddEntityModal, setShowAddEntityModal] = useState(false);

  // Show server connection error if not connected
  if (!isConnected) {
    return (
      <div className="noise min-h-screen bg-surface-0 flex items-center justify-center">
        <div className="glass-card rounded-2xl p-10 max-w-md text-center animate-scale-in">
          <div className="p-4 bg-danger-500/10 rounded-2xl w-fit mx-auto mb-5">
            <Server className="w-8 h-8 text-danger-400" />
          </div>
          <h1 className="font-display text-2xl text-surface-950 mb-2 italic">
            Server Not Connected
          </h1>
          <p className="text-surface-800 mb-6 text-sm leading-relaxed">
            The DocVault API server is not running. Start it with:
            <code className="block mt-3 bg-surface-200/50 text-accent-400 p-3 rounded-lg text-sm font-mono">
              bun run server
            </code>
          </p>
          <button
            onClick={checkConnection}
            className="w-full bg-accent-500 text-surface-0 py-3 px-4 rounded-xl font-medium hover:bg-accent-400 transition-all duration-200 active:scale-[0.98]"
          >
            Retry Connection
          </button>
          {fsError && (
            <p className="mt-4 text-sm text-danger-400 flex items-center justify-center gap-2">
              <AlertCircle className="w-4 h-4" />
              {fsError}
            </p>
          )}
        </div>
      </div>
    );
  }

  // Render the active view (search overrides everything)
  const renderContent = () => {
    if (searchActive) {
      return <SearchResultsView />;
    }

    switch (activeView) {
      case 'tax-year':
        return <TaxYearView />;
      case 'business-docs':
        return <BusinessDocsView />;
      case 'all-files':
        return <AllFilesView />;
      case 'settings':
        return <SettingsView />;
      case 'tn-tax':
        return <TnTaxView />;
      case 'crypto':
        return <CryptoView />;
      case 'brokers':
        return <BrokersView />;
      case 'banks':
        return <BanksView />;
      case 'portfolio':
        return <PortfolioView />;
      default:
        return <TaxYearView />;
    }
  };

  return (
    <div className="noise flex h-screen bg-surface-0">
      {/* Desktop Sidebar */}
      <div className="hidden md:flex">
        <Sidebar onAddEntity={() => setShowAddEntityModal(true)} />
      </div>

      {/* Mobile Sidebar Drawer */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setSidebarOpen(false)}
          />
          {/* Drawer */}
          <div className="relative w-72 h-full animate-slide-in">
            <Sidebar
              onAddEntity={() => {
                setShowAddEntityModal(true);
                setSidebarOpen(false);
              }}
              onClose={() => setSidebarOpen(false)}
            />
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-auto">{renderContent()}</main>
      </div>

      {/* Add Entity Modal */}
      <AddEntityModal isOpen={showAddEntityModal} onClose={() => setShowAddEntityModal(false)} />
    </div>
  );
}
