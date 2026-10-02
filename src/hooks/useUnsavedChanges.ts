import { useEffect } from 'react';
import { useNavigationGuard } from '../contexts/NavigationGuardContext';

export function useUnsavedChanges(dirty: boolean, saving = false) {
  const { registerBlocker } = useNavigationGuard();
  useEffect(() => registerBlocker({ dirty, saving }), [dirty, saving, registerBlocker]);
}
