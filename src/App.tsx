import { Dashboard } from './components/Dashboard';
import { ToastProvider } from './components/ui/Toast';

function App() {
  return (
    <ToastProvider>
      <Dashboard />
    </ToastProvider>
  );
}

export default App;
