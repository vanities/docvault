import { useState } from 'react';
import { Server, AlertCircle } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet';
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
import { SalesView } from '../Sales/SalesView';
import { MileageView } from '../Mileage/MileageView';
import { GoldView } from '../Gold/GoldView';
import { PropertyView } from '../Property/PropertyView';
import { IncomeView } from '../Income/IncomeView';
import { Solo401kView } from '../Solo401k/Solo401kView';
import { EstimatedTaxView } from '../EstimatedTax/EstimatedTaxView';
import { FederalTaxView } from '../FederalTax/FederalTaxView';
import { QuantView } from '../Quant/QuantView';
import { StrategyView } from '../Strategy/StrategyView';
import { HealthView } from '../Health/HealthView';
import { HealthActivityView } from '../Health/HealthActivityView';
import { HealthDNAView } from '../Health/HealthDNAView';
import { HealthHeartView } from '../Health/HealthHeartView';
import { HealthSleepView } from '../Health/HealthSleepView';
import { HealthWorkoutsView } from '../Health/HealthWorkoutsView';
import { HealthBodyView } from '../Health/HealthBodyView';
import { HealthRecordsView } from '../Health/HealthRecordsView';
import { HealthNutritionView } from '../Health/HealthNutritionView';
import { HealthSicknessView } from '../Health/HealthSicknessView';
import { HealthAnalysisView } from '../Health/HealthAnalysisView';
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
        <Card variant="glass" className="rounded-2xl p-10 max-w-md text-center animate-scale-in">
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
          <Button onClick={checkConnection} className="w-full" size="lg">
            Retry Connection
          </Button>
          {fsError && (
            <p className="mt-4 text-sm text-danger-400 flex items-center justify-center gap-2">
              <AlertCircle className="w-4 h-4" />
              {fsError}
            </p>
          )}
        </Card>
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
      case 'solo-401k':
        return <Solo401kView />;
      case 'estimated-tax':
        return <EstimatedTaxView />;
      case 'federal-tax':
        return <FederalTaxView />;
      case 'crypto':
        return <CryptoView />;
      case 'brokers':
        return <BrokersView />;
      case 'banks':
        return <BanksView />;
      case 'portfolio':
        return <PortfolioView />;
      case 'sales':
        return <SalesView />;
      case 'mileage':
        return <MileageView />;
      case 'gold':
        return <GoldView />;
      case 'property':
        return <PropertyView />;
      case 'income':
        return <IncomeView />;
      case 'quant':
        return <QuantView />;
      case 'strategy':
        return <StrategyView />;
      case 'health':
        return <HealthView />;
      case 'health-activity':
        return <HealthActivityView />;
      case 'health-heart':
        return <HealthHeartView />;
      case 'health-sleep':
        return <HealthSleepView />;
      case 'health-workouts':
        return <HealthWorkoutsView />;
      case 'health-body':
        return <HealthBodyView />;
      case 'health-records':
        return <HealthRecordsView />;
      case 'health-dna':
        return <HealthDNAView />;
      case 'health-nutrition':
        return <HealthNutritionView />;
      case 'health-sickness':
        return <HealthSicknessView />;
      case 'health-analysis':
        return <HealthAnalysisView />;
      default:
        return <TaxYearView />;
    }
  };

  return (
    <div className="noise flex h-dvh bg-surface-0">
      {/* Desktop Sidebar */}
      <div className="hidden md:flex">
        <Sidebar onAddEntity={() => setShowAddEntityModal(true)} />
      </div>

      {/* Mobile Sidebar Drawer */}
      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent side="left" showCloseButton={false} className="w-72 p-0 gap-0 md:hidden">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SheetDescription className="sr-only">Main navigation menu</SheetDescription>
          <Sidebar
            onAddEntity={() => {
              setShowAddEntityModal(true);
              setSidebarOpen(false);
            }}
            onClose={() => setSidebarOpen(false)}
          />
        </SheetContent>
      </Sheet>

      <div className="flex-1 flex flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-auto pb-[env(safe-area-inset-bottom)]">
          {renderContent()}
        </main>
      </div>

      {/* Add Entity Modal */}
      <AddEntityModal isOpen={showAddEntityModal} onClose={() => setShowAddEntityModal(false)} />
    </div>
  );
}
