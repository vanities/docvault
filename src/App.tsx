import { Toaster } from 'sonner';
import { Layout } from './components/Layout';
import { LoginScreen } from './components/Auth/LoginScreen';
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
    <TooltipProvider>
      <AppProvider>
        <AppContent />
      </AppProvider>
      <Toaster
        theme="dark"
        position="bottom-right"
        toastOptions={{
          style: {
            background: 'rgba(22, 24, 30, 0.85)',
            backdropFilter: 'blur(24px)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            color: 'var(--color-surface-900)',
          },
        }}
      />
    </TooltipProvider>
  );
}

export default App;
