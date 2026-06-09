import { useEffect, useState } from 'react';
import { Cloud, RefreshCw } from 'lucide-react';
import { API_BASE } from '../../constants';
import { requestJson } from '../../api/client';
import { useToast } from '../../hooks/useToast';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';

interface DropboxStatus {
  configured: boolean;
  rcloneInstalled: boolean;
  syncScript?: boolean;
  connected?: boolean;
  error?: string;
  usage?: { total?: number; used?: number; free?: number };
}

export function DropboxConnectionSection() {
  const { addToast } = useToast();
  const [status, setStatus] = useState<DropboxStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [tokenInput, setTokenInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [showTokenForm, setShowTokenForm] = useState(false);

  const fetchStatus = async () => {
    try {
      setStatus(await requestJson<DropboxStatus>(`${API_BASE}/dropbox/status`));
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchStatus();
  }, []);

  const handleSaveToken = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tokenInput.trim()) return;
    setSaving(true);
    try {
      await requestJson<unknown>(`${API_BASE}/dropbox/authorize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tokenInput.trim() }),
      });
      addToast('Dropbox token saved', 'success');
      setTokenInput('');
      setShowTokenForm(false);
      setLoading(true);
      await fetchStatus();
    } catch {
      addToast('Failed to save token', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSyncNow = async () => {
    setSyncing(true);
    try {
      await requestJson<unknown>(`${API_BASE}/dropbox/sync`, { method: 'POST' });
      addToast('Dropbox sync started', 'success');
    } catch {
      addToast('Failed to start sync', 'error');
    } finally {
      setTimeout(() => setSyncing(false), 3000);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
    return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  };

  if (loading) {
    return (
      <Card variant="glass" className="p-6 mb-8">
        <h3 className="text-lg font-semibold text-surface-950 mb-4 flex items-center gap-2">
          <Cloud className="w-5 h-5" />
          Dropbox Connection
        </h3>
        <div className="flex items-center gap-2 text-surface-600 text-sm">
          <RefreshCw className="w-4 h-4 animate-spin" />
          Checking...
        </div>
      </Card>
    );
  }

  return (
    <Card variant="glass" className="p-6 mb-8">
      <h3 className="text-lg font-semibold text-surface-950 mb-4 flex items-center gap-2">
        <Cloud className="w-5 h-5" />
        Dropbox Connection
      </h3>

      {!status?.rcloneInstalled && (
        <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl">
          <p className="text-[13px] text-amber-500">
            rclone is not installed in the container. Rebuild with the latest Docker image.
          </p>
        </div>
      )}

      {status?.rcloneInstalled && !status.configured && (
        <div className="space-y-3">
          <div className="p-4 bg-surface-200/30 border border-surface-400/20 rounded-xl">
            <p className="text-[13px] text-surface-700 mb-2">
              Dropbox is not connected. To set up:
            </p>
            <ol className="text-[12px] text-surface-600 list-decimal ml-4 space-y-1">
              <li>
                Run{' '}
                <code className="bg-surface-200 px-1.5 py-0.5 rounded text-accent-400 text-[11px]">
                  rclone authorize &quot;dropbox&quot;
                </code>{' '}
                on a machine with a browser
              </li>
              <li>Authorize in the browser when prompted</li>
              <li>Paste the JSON token below</li>
            </ol>
          </div>
          <button
            onClick={() => setShowTokenForm(!showTokenForm)}
            className="text-[12px] text-accent-400 hover:text-accent-300 transition-colors"
          >
            {showTokenForm ? 'Cancel' : 'I have a token — paste it'}
          </button>
        </div>
      )}

      {status?.rcloneInstalled && status.configured && (
        <div className="space-y-3">
          <div
            className={`flex items-center gap-3 p-4 rounded-xl border ${
              status.connected
                ? 'bg-emerald-500/8 border-emerald-500/20'
                : 'bg-red-500/10 border-red-500/25'
            }`}
          >
            <div
              className={`w-2.5 h-2.5 rounded-full ${status.connected ? 'bg-emerald-400' : 'bg-red-400'}`}
            />
            <div className="flex-1 min-w-0">
              <p
                className={`text-[13px] font-medium ${status.connected ? 'text-emerald-400' : 'text-red-400'}`}
              >
                {status.connected ? 'Connected' : 'Connection Failed'}
              </p>
              {status.usage?.total && (
                <p className="text-[11px] text-surface-500">
                  {formatBytes(status.usage.used || 0)} used of{' '}
                  {formatBytes(status.usage.total || 0)}
                </p>
              )}
              {!status.connected && status.error && (
                <p className="text-[11px] text-red-400/80 truncate">{status.error}</p>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                variant="ghost"
                size="xs"
                onClick={handleSyncNow}
                disabled={syncing || !status.connected}
                className="text-accent-400 bg-accent-500/10 hover:bg-accent-500/20"
              >
                {syncing ? 'Syncing...' : 'Sync Now'}
              </Button>
              <Button
                variant="secondary"
                size="xs"
                onClick={() => setShowTokenForm(!showTokenForm)}
              >
                Reauth
              </Button>
            </div>
          </div>
        </div>
      )}

      {showTokenForm && (
        <form onSubmit={handleSaveToken} className="mt-3 space-y-2">
          <Textarea
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            placeholder='Paste the JSON token from rclone authorize "dropbox"'
            rows={3}
            className="text-[12px] font-mono resize-none"
          />
          <Button type="submit" size="sm" disabled={saving || !tokenInput.trim()}>
            {saving ? 'Saving...' : 'Save Token'}
          </Button>
        </form>
      )}
    </Card>
  );
}
