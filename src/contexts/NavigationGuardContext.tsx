/* oxlint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import { useConfirmDialog } from '../hooks/useConfirmDialog';
import { useToast } from '../hooks/useToast';

type Blocker = { dirty: boolean; saving: boolean };
interface NavigationGuard {
  registerBlocker: (blocker: Blocker) => () => void;
  requestNavigation: () => Promise<boolean>;
}
const NavigationGuardContext = createContext<NavigationGuard | null>(null);

/** One guard for editor unmounts, section changes, search and browser history. */
export function NavigationGuardProvider({ children }: { children: ReactNode }) {
  const blockers = useRef(new Map<symbol, Blocker>());
  const pending = useRef<Promise<boolean> | null>(null);
  const { confirm, confirmDialog } = useConfirmDialog();
  const { addToast } = useToast();
  const registerBlocker = useCallback((blocker: Blocker) => {
    const key = Symbol();
    if (blocker.dirty || blocker.saving) blockers.current.set(key, blocker);
    return () => {
      blockers.current.delete(key);
    };
  }, []);
  const requestNavigation = useCallback(() => {
    if (pending.current) return pending.current;
    if ([...blockers.current.values()].some((blocker) => blocker.saving)) {
      addToast('Wait for your changes to finish saving.', 'info');
      return Promise.resolve(false);
    }
    if (![...blockers.current.values()].some((blocker) => blocker.dirty))
      return Promise.resolve(true);
    const request = confirm({
      title: 'Discard unsaved changes?',
      description: 'Your edits have not been saved. Leave this editor?',
      confirmLabel: 'Discard changes',
      destructive: true,
    });
    pending.current = request;
    void request.finally(() => {
      if (pending.current === request) pending.current = null;
    });
    return request;
  }, [addToast, confirm]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!blockers.current.size) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
  const value = useMemo(
    () => ({ registerBlocker, requestNavigation }),
    [registerBlocker, requestNavigation]
  );
  return (
    <NavigationGuardContext.Provider value={value}>
      {children}
      {confirmDialog}
    </NavigationGuardContext.Provider>
  );
}

export function useNavigationGuard() {
  const guard = useContext(NavigationGuardContext);
  if (!guard) throw new Error('NavigationGuardProvider is required');
  return guard;
}
