import { Layout } from './components/Layout';
import { LoginScreen } from './components/Auth/LoginScreen';
import { ToastProvider } from './components/ui/Toast';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AppProvider, useAppContext } from './contexts/AppContext';

function AppContent() {
  const { authRequired, authenticated, checkConnection } = useAppContext();

  if (authRequired && !authenticated) {
    return <LoginScreen onLogin={checkConnection} />;
  }

  return <Layout />;
}

function App() {
  return (
    <ToastProvider>
      <TooltipProvider>
        <AppProvider>
          <AppContent />
        </AppProvider>
      </TooltipProvider>
    </ToastProvider>
  );
}

export default App;
