import { Layout } from './components/Layout';
import { ToastProvider } from './components/ui/Toast';
import { AppProvider } from './contexts/AppContext';

function App() {
  return (
    <ToastProvider>
      <AppProvider>
        <Layout />
      </AppProvider>
    </ToastProvider>
  );
}

export default App;
