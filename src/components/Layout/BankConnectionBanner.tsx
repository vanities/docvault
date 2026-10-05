import { useEffect, useState } from 'react';
import { AlertTriangle, ExternalLink } from 'lucide-react';
import { API_BASE, SIMPLEFIN_STATUS_EVENT } from '../../constants';
import { requestJson } from '../../api/client';
import { useAppContext } from '../../contexts/AppContext';
import type { SimplefinHealth } from '../../../server/simplefin-health';

export function BankConnectionBanner() {
  const { activeView, setActiveView } = useAppContext();
  const [health, setHealth] = useState<SimplefinHealth>();
  useEffect(() => {
    let disposed = false;
    let controller: AbortController | undefined;
    const refresh = async () => {
      controller?.abort();
      controller = new AbortController();
      try {
        const status = await requestJson<SimplefinHealth & { configured: boolean }>(
          `${API_BASE}/simplefin/status`,
          { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) }
        );
        if (!disposed) setHealth(status.configured ? status : undefined);
      } catch {
        // Keep an existing warning visible during a temporary API outage.
      }
    };
    void refresh();
    const interval = setInterval(() => void refresh(), 30_000);
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    window.addEventListener(SIMPLEFIN_STATUS_EVENT, onFocus);
    return () => {
      disposed = true;
      controller?.abort();
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener(SIMPLEFIN_STATUS_EVENT, onFocus);
    };
  }, []);
  const issues = health?.issues ?? [];
  if (!issues.length || activeView === 'banks') return null;
  const authIssues = issues.filter((issue) => issue.kind === 'reauth');
  const names = [
    ...new Set(
      (authIssues.length ? authIssues : issues).map((issue) => issue.connectionName).filter(Boolean)
    ),
  ];
  return (
    <div role="status" className="border-b border-amber-500/25 bg-amber-500/10 px-4 py-3 md:px-6">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2 text-sm">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
        <div className="min-w-0 flex-1 basis-48 break-words">
          <p className="font-medium text-surface-950">
            {authIssues.length ? 'Bank sign-in required' : 'Bank sync needs attention'}
          </p>
          <p className="text-xs text-surface-700">
            {names.length ? names.join(', ') : issues[0].message}. Balances may be out of date.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 pl-8 md:pl-0">
          {authIssues.length > 0 && (
            <a
              href="https://beta-bridge.simplefin.org"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-medium text-accent-500 hover:underline"
            >
              Reconnect banks <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
          )}
          <button
            onClick={() => setActiveView('banks')}
            className="text-accent-500 hover:underline"
          >
            Details and history
          </button>
        </div>
      </div>
    </div>
  );
}
