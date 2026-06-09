import { lazy, Suspense, useState } from 'react';
import { Server, AlertCircle } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { useAppContext } from '../../contexts/AppContext';
import { AddEntityModal } from '../Settings/AddEntityModal';

const TaxYearView = lazy(() =>
  import('../TaxYear/TaxYearView').then((m) => ({ default: m.TaxYearView }))
);
const BusinessDocsView = lazy(() =>
  import('../BusinessDocs/BusinessDocsView').then((m) => ({ default: m.BusinessDocsView }))
);
const AllFilesView = lazy(() =>
  import('../AllFiles/AllFilesView').then((m) => ({ default: m.AllFilesView }))
);
const ChatView = lazy(() => import('../Chat/ChatView').then((m) => ({ default: m.ChatView })));
const SettingsView = lazy(() =>
  import('../Settings/SettingsView').then((m) => ({ default: m.SettingsView }))
);
const ExternalSourcesView = lazy(() =>
  import('../ExternalSources/ExternalSourcesView').then((m) => ({ default: m.ExternalSourcesView }))
);
const ResearchView = lazy(() =>
  import('../Research/ResearchView').then((m) => ({ default: m.ResearchView }))
);
const DailyNewsView = lazy(() =>
  import('../DailyNews/DailyNewsView').then((m) => ({ default: m.DailyNewsView }))
);
const TnTaxView = lazy(() => import('../TnTax/TnTaxView').then((m) => ({ default: m.TnTaxView })));
const CryptoView = lazy(() =>
  import('../Crypto/CryptoView').then((m) => ({ default: m.CryptoView }))
);
const BrokersView = lazy(() =>
  import('../Brokers/BrokersView').then((m) => ({ default: m.BrokersView }))
);
const BanksView = lazy(() => import('../Banks/BanksView').then((m) => ({ default: m.BanksView })));
const PortfolioView = lazy(() =>
  import('../Portfolio/PortfolioView').then((m) => ({ default: m.PortfolioView }))
);
const SalesView = lazy(() => import('../Sales/SalesView').then((m) => ({ default: m.SalesView })));
const MileageView = lazy(() =>
  import('../Mileage/MileageView').then((m) => ({ default: m.MileageView }))
);
const GoldView = lazy(() => import('../Gold/GoldView').then((m) => ({ default: m.GoldView })));
const PropertyView = lazy(() =>
  import('../Property/PropertyView').then((m) => ({ default: m.PropertyView }))
);
const IncomeView = lazy(() =>
  import('../Income/IncomeView').then((m) => ({ default: m.IncomeView }))
);
const DebtsView = lazy(() => import('../Debts/DebtsView').then((m) => ({ default: m.DebtsView })));
const Solo401kView = lazy(() =>
  import('../Solo401k/Solo401kView').then((m) => ({ default: m.Solo401kView }))
);
const EstimatedTaxView = lazy(() =>
  import('../EstimatedTax/EstimatedTaxView').then((m) => ({ default: m.EstimatedTaxView }))
);
const FederalTaxView = lazy(() =>
  import('../FederalTax/FederalTaxView').then((m) => ({ default: m.FederalTaxView }))
);
const QuantView = lazy(() => import('../Quant/QuantView').then((m) => ({ default: m.QuantView })));
const StrategyView = lazy(() =>
  import('../Strategy/StrategyView').then((m) => ({ default: m.StrategyView }))
);
const PoliticsView = lazy(() =>
  import('../Politics/PoliticsView').then((m) => ({ default: m.PoliticsView }))
);
const PredictionsView = lazy(() =>
  import('../Predictions/PredictionsView').then((m) => ({ default: m.PredictionsView }))
);
const HealthView = lazy(() =>
  import('../Health/HealthView').then((m) => ({ default: m.HealthView }))
);
const HealthActivityView = lazy(() =>
  import('../Health/HealthActivityView').then((m) => ({ default: m.HealthActivityView }))
);
const HealthDNAView = lazy(() =>
  import('../Health/HealthDNAView').then((m) => ({ default: m.HealthDNAView }))
);
const HealthHeartView = lazy(() =>
  import('../Health/HealthHeartView').then((m) => ({ default: m.HealthHeartView }))
);
const HealthSleepView = lazy(() =>
  import('../Health/HealthSleepView').then((m) => ({ default: m.HealthSleepView }))
);
const HealthWorkoutsView = lazy(() =>
  import('../Health/HealthWorkoutsView').then((m) => ({ default: m.HealthWorkoutsView }))
);
const HealthBodyView = lazy(() =>
  import('../Health/HealthBodyView').then((m) => ({ default: m.HealthBodyView }))
);
const HealthRecordsView = lazy(() =>
  import('../Health/HealthRecordsView').then((m) => ({ default: m.HealthRecordsView }))
);
const HealthNutritionView = lazy(() =>
  import('../Health/HealthNutritionView').then((m) => ({ default: m.HealthNutritionView }))
);
const HealthSicknessView = lazy(() =>
  import('../Health/HealthSicknessView').then((m) => ({ default: m.HealthSicknessView }))
);
const HealthAnalysisView = lazy(() =>
  import('../Health/HealthAnalysisView').then((m) => ({ default: m.HealthAnalysisView }))
);
const HealthResearchView = lazy(() =>
  import('../Health/HealthResearchView').then((m) => ({ default: m.HealthResearchView }))
);
const SearchResultsView = lazy(() =>
  import('../Search/SearchResultsView').then((m) => ({ default: m.SearchResultsView }))
);

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
      case 'chat':
        return <ChatView />;
      case 'external-sources':
        return <ExternalSourcesView />;
      case 'deep-research':
        return <ResearchView />;
      case 'daily-news':
        return <DailyNewsView />;
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
      case 'debts':
        return <DebtsView />;
      case 'quant':
        return <QuantView />;
      case 'strategy':
        return <StrategyView />;
      case 'politics':
        return <PoliticsView />;
      case 'predictions':
        return <PredictionsView />;
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
      case 'health-research':
        return <HealthResearchView />;
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
        <main className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden pb-[env(safe-area-inset-bottom)]">
          <Suspense fallback={<div className="p-6 text-sm text-surface-600">Loading view…</div>}>
            {renderContent()}
          </Suspense>
        </main>
      </div>

      {/* Add Entity Modal */}
      <AddEntityModal isOpen={showAddEntityModal} onClose={() => setShowAddEntityModal(false)} />
    </div>
  );
}
