import { useState, useEffect } from 'react';
import {
  Key,
  Save,
  Eye,
  EyeOff,
  CheckCircle,
  AlertCircle,
  Building2,
  Pencil,
  Trash2,
  Cloud,
  RefreshCw,
  Bitcoin,
  Plus,
  Wallet,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  ExternalLink,
  Download,
  Upload,
  Shield,
  Landmark,
} from 'lucide-react';
import type { SyncStatus, CryptoExchangeId, CryptoChain } from '../../types';
import { useAppContext } from '../../contexts/AppContext';
import { useToast } from '../../hooks/useToast';
import type { EntityConfig } from '../../hooks/useFileSystemServer';
import { API_BASE } from '../../constants';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  AVAILABLE_ICONS,
  DEFAULT_ENTITY_ICONS,
  getEntityIcon,
  SETTINGS_COLOR_MAP as COLOR_MAP,
  AVAILABLE_COLORS,
} from '../../utils/entityDisplay';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface SettingsData {
  hasAnthropicKey: boolean;
  keySource?: 'settings' | 'env';
  keyHint?: string;
  claudeModel?: string;
  hasGeoapifyKey?: boolean;
  geoapifyKeyHint?: string;
}

function formatRelativeTime(isoStr: string): string {
  const date = new Date(isoStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.round(diffMs / 60000);

  if (diffMin < 0) {
    // Future
    const futureMin = Math.abs(diffMin);
    if (futureMin < 1) return 'any moment';
    if (futureMin < 60) return `in ${futureMin}m`;
    return `in ${Math.round(futureMin / 60)}h`;
  }

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface DropboxStatus {
  configured: boolean;
  rcloneInstalled: boolean;
  syncScript?: boolean;
  connected?: boolean;
  error?: string;
  usage?: { total?: number; used?: number; free?: number };
}

function DropboxConnectionSection() {
  const { addToast } = useToast();
  const [status, setStatus] = useState<DropboxStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [tokenInput, setTokenInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [showTokenForm, setShowTokenForm] = useState(false);

  const fetchStatus = async () => {
    try {
      const res = await fetch(`${API_BASE}/dropbox/status`);
      setStatus(await res.json());
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
      const res = await fetch(`${API_BASE}/dropbox/authorize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tokenInput.trim() }),
      });
      if (res.ok) {
        addToast('Dropbox token saved', 'success');
        setTokenInput('');
        setShowTokenForm(false);
        setLoading(true);
        await fetchStatus();
      } else {
        addToast('Failed to save token', 'error');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSyncNow = async () => {
    setSyncing(true);
    try {
      await fetch(`${API_BASE}/dropbox/sync`, { method: 'POST' });
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
              {status.connected && status.usage && (
                <p className="text-[11px] text-surface-600">
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
          <textarea
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            placeholder='Paste the JSON token from rclone authorize "dropbox"'
            rows={3}
            className="w-full px-3 py-2 bg-surface-100 border border-border rounded-lg text-[12px] font-mono text-surface-950 placeholder:text-surface-500 focus:outline-none focus:ring-2 focus:ring-accent-400/30 resize-none"
          />
          <Button type="submit" size="sm" disabled={saving || !tokenInput.trim()}>
            {saving ? 'Saving...' : 'Save Token'}
          </Button>
        </form>
      )}
    </Card>
  );
}

export function SettingsView() {
  const { entities, updateEntity, removeEntity, selectedEntity, setSelectedEntity } =
    useAppContext();
  const { addToast } = useToast();

  // API Key state
  const [anthropicKey, setAnthropicKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [hasKey, setHasKey] = useState(false);
  const [keySource, setKeySource] = useState<'settings' | 'env' | undefined>();
  const [claudeModel, setClaudeModel] = useState('claude-sonnet-4-6');
  const [keyHint, setKeyHint] = useState<string | undefined>();

  // Geoapify API Key state
  const [hasGeoapifyKey, setHasGeoapifyKey] = useState(false);
  const [geoapifyKeyHint, setGeoapifyKeyHint] = useState<string | undefined>();
  const [newGeoapifyKey, setNewGeoapifyKey] = useState('');

  // Sync status state
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [cryptoLastUpdated, setCryptoLastUpdated] = useState<string | null>(null);
  const [brokerLastUpdated, setBrokerLastUpdated] = useState<string | null>(null);
  const [bankLastUpdated, setBankLastUpdated] = useState<string | null>(null);

  // Entity editing state
  const [editingEntity, setEditingEntity] = useState<EntityConfig | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');
  const [editIcon, setEditIcon] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [isEntitySaving, setIsEntitySaving] = useState(false);

  // Crypto settings state
  const [cryptoExchanges, setCryptoExchanges] = useState<
    { id: CryptoExchangeId; enabled: boolean; hasKey: boolean; keyHint?: string }[]
  >([]);
  const [cryptoWallets, setCryptoWallets] = useState<
    { id: string; address: string; chain: CryptoChain; label: string }[]
  >([]);
  const [showAddExchange, setShowAddExchange] = useState(false);
  const [newExchangeId, setNewExchangeId] = useState<CryptoExchangeId>('coinbase');
  const [newExchangeKey, setNewExchangeKey] = useState('');
  const [newExchangeSecret, setNewExchangeSecret] = useState('');
  const [newExchangePassphrase, setNewExchangePassphrase] = useState('');
  const [showAddWallet, setShowAddWallet] = useState(false);
  const [newWalletChain, setNewWalletChain] = useState<CryptoChain>('btc');
  const [newWalletAddress, setNewWalletAddress] = useState('');
  const [newWalletLabel, setNewWalletLabel] = useState('');
  const [isCryptoSaving, setIsCryptoSaving] = useState(false);
  const [showExchangeHelp, setShowExchangeHelp] = useState(false);
  const [showWalletHelp, setShowWalletHelp] = useState(false);
  const [hasEtherscanKey, setHasEtherscanKey] = useState(false);
  const [etherscanKeyHint, setEtherscanKeyHint] = useState<string | undefined>();
  const [newEtherscanKey, setNewEtherscanKey] = useState('');

  // Show/hide toggles for collapsible lists
  const [showAllExchanges, setShowAllExchanges] = useState(false);
  const [showAllWallets, setShowAllWallets] = useState(false);
  const [showAllEntities, setShowAllEntities] = useState(false);

  // SimpleFIN settings state
  const [simplefinToken, setSimplefinToken] = useState('');
  const [simplefinConfigured, setSimplefinConfigured] = useState(false);
  const [isSimplefinSaving, setIsSimplefinSaving] = useState(false);

  // SnapTrade settings state
  const [snapTradeStatus, setSnapTradeStatus] = useState<{
    configured: boolean;
    registered: boolean;
  } | null>(null);
  const [snapTradeClientId, setSnapTradeClientId] = useState('');
  const [snapTradeConsumerKey, setSnapTradeConsumerKey] = useState('');
  const [isSnapTradeSaving, setIsSnapTradeSaving] = useState(false);

  // Schedule settings state
  const [snapshotEnabled, setSnapshotEnabled] = useState(true);
  const [snapshotInterval, setSnapshotInterval] = useState(1440);
  const [dropboxSyncEnabled, setDropboxSyncEnabled] = useState(true);
  const [dropboxSyncInterval, setDropboxSyncInterval] = useState(15);
  const [autoBackupPasswordSet, setAutoBackupPasswordSet] = useState(false);
  const [autoBackupPassword, setAutoBackupPassword] = useState('');
  const [isScheduleSaving, setIsScheduleSaving] = useState(false);
  const [scheduleSaved, setScheduleSaved] = useState(false);

  // Load settings and sync status on mount
  useEffect(() => {
    void loadSettings();
    void loadSyncStatus();
    void loadCacheStatus();
    void loadCryptoSettings();
    void loadSimplefinStatus();
    void loadSnapTradeStatus();
    void loadSchedules();
    const interval = setInterval(() => {
      void loadSyncStatus();
      void loadCacheStatus();
    }, 30000); // Poll every 30s
    return () => clearInterval(interval);
  }, []);

  const loadSyncStatus = async () => {
    try {
      const res = await fetch(`${API_BASE}/sync-status`);
      const data: SyncStatus = await res.json();
      setSyncStatus(data);
    } catch {
      setSyncStatus(null);
    }
  };

  const loadCacheStatus = async () => {
    try {
      const res = await fetch(`${API_BASE}/cache-status`);
      const data = await res.json();
      setCryptoLastUpdated(data.cryptoLastUpdated || null);
      setBrokerLastUpdated(data.brokerLastUpdated || null);
      setBankLastUpdated(data.bankLastUpdated || null);
    } catch {
      // Silently fail
    }
  };

  const loadSettings = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`${API_BASE}/settings`);
      const data: SettingsData = await response.json();
      setHasKey(data.hasAnthropicKey || false);
      setKeySource(data.keySource);
      setKeyHint(data.keyHint);
      if (data.claudeModel) setClaudeModel(data.claudeModel);
      setAnthropicKey('');
      setHasGeoapifyKey(data.hasGeoapifyKey || false);
      setGeoapifyKeyHint(data.geoapifyKeyHint);
    } catch (err) {
      console.error('Failed to load settings:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveKey = async () => {
    setIsSaving(true);
    setSaveStatus('idle');

    try {
      const response = await fetch(`${API_BASE}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ anthropicKey: anthropicKey || undefined }),
      });

      const data = await response.json();
      if (data.ok) {
        setSaveStatus('success');
        setHasKey(true);
        setAnthropicKey('');
        addToast('API key saved successfully', 'success');
        setTimeout(() => setSaveStatus('idle'), 3000);
      } else {
        setSaveStatus('error');
      }
    } catch (err) {
      console.error('Failed to save settings:', err);
      setSaveStatus('error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleClearKey = async () => {
    setIsSaving(true);
    try {
      const response = await fetch(`${API_BASE}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clearAnthropicKey: true }),
      });

      const data = await response.json();
      if (data.ok) {
        setHasKey(false);
        addToast('API key removed', 'success');
      }
    } catch (err) {
      console.error('Failed to clear key:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveGeoapifyKey = async () => {
    if (!newGeoapifyKey) return;
    setIsSaving(true);
    try {
      const res = await fetch(`${API_BASE}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ geoapifyApiKey: newGeoapifyKey }),
      });
      if ((await res.json()).ok) {
        addToast('Geoapify key saved', 'success');
        setNewGeoapifyKey('');
        void loadSettings();
      }
    } catch {
      addToast('Failed to save Geoapify key', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemoveGeoapifyKey = async () => {
    setIsSaving(true);
    try {
      const res = await fetch(`${API_BASE}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ geoapifyApiKey: '' }),
      });
      if ((await res.json()).ok) {
        addToast('Geoapify key removed', 'success');
        void loadSettings();
      }
    } catch {
      addToast('Failed to remove Geoapify key', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveModel = async (model: string) => {
    setClaudeModel(model);
    try {
      await fetch(`${API_BASE}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claudeModel: model }),
      });
      addToast(`Model set to ${model}`, 'success');
    } catch {
      addToast('Failed to save model', 'error');
    }
  };

  const handleEditEntity = (entity: EntityConfig) => {
    setEditingEntity(entity);
    setEditName(entity.name);
    setEditColor(entity.color);
    setEditIcon(entity.icon || DEFAULT_ENTITY_ICONS[entity.id] || 'building');
    setEditDescription(entity.description || '');
  };

  const handleCancelEdit = () => {
    setEditingEntity(null);
    setEditName('');
    setEditColor('');
    setEditIcon('');
    setEditDescription('');
  };

  const handleSaveEntity = async () => {
    if (!editingEntity) return;

    setIsEntitySaving(true);
    const result = await updateEntity(editingEntity.id, {
      name: editName,
      color: editColor,
      icon: editIcon,
      description: editDescription,
    });
    setIsEntitySaving(false);

    if (result) {
      addToast('Entity updated successfully', 'success');
      setEditingEntity(null);
    } else {
      addToast('Failed to update entity', 'error');
    }
  };

  // Crypto settings functions
  const loadCryptoSettings = async () => {
    try {
      const res = await fetch(`${API_BASE}/crypto/settings`);
      const data = await res.json();
      setCryptoExchanges(data.exchanges || []);
      setCryptoWallets(data.wallets || []);
      setHasEtherscanKey(data.hasEtherscanKey || false);
      setEtherscanKeyHint(data.etherscanKeyHint);
    } catch {
      // Silently fail — crypto is optional
    }
  };

  const handleAddExchange = async () => {
    if (!newExchangeKey || !newExchangeSecret) return;
    setIsCryptoSaving(true);
    try {
      const res = await fetch(`${API_BASE}/crypto/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          addExchange: {
            id: newExchangeId,
            apiKey: newExchangeKey,
            apiSecret: newExchangeSecret,
            passphrase: newExchangePassphrase || undefined,
          },
        }),
      });
      if ((await res.json()).ok) {
        addToast(`${newExchangeId} added`, 'success');
        setShowAddExchange(false);
        setNewExchangeKey('');
        setNewExchangeSecret('');
        setNewExchangePassphrase('');
        void loadCryptoSettings();
      }
    } catch {
      addToast('Failed to add exchange', 'error');
    } finally {
      setIsCryptoSaving(false);
    }
  };

  const handleRemoveExchange = async (exchangeId: string) => {
    if (!confirm(`Remove ${exchangeId} API keys?`)) return;
    setIsCryptoSaving(true);
    try {
      const res = await fetch(`${API_BASE}/crypto/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ removeExchange: exchangeId }),
      });
      if ((await res.json()).ok) {
        addToast(`${exchangeId} removed`, 'success');
        void loadCryptoSettings();
      }
    } catch {
      addToast('Failed to remove exchange', 'error');
    } finally {
      setIsCryptoSaving(false);
    }
  };

  const handleAddWallet = async () => {
    if (!newWalletAddress) return;
    setIsCryptoSaving(true);
    try {
      const res = await fetch(`${API_BASE}/crypto/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          addWallet: {
            address: newWalletAddress,
            chain: newWalletChain,
            label: newWalletLabel || undefined,
          },
        }),
      });
      if ((await res.json()).ok) {
        addToast('Wallet added', 'success');
        setShowAddWallet(false);
        setNewWalletAddress('');
        setNewWalletLabel('');
        void loadCryptoSettings();
      }
    } catch {
      addToast('Failed to add wallet', 'error');
    } finally {
      setIsCryptoSaving(false);
    }
  };

  const handleRemoveWallet = async (walletId: string) => {
    if (!confirm('Remove this wallet?')) return;
    setIsCryptoSaving(true);
    try {
      const res = await fetch(`${API_BASE}/crypto/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ removeWallet: walletId }),
      });
      if ((await res.json()).ok) {
        addToast('Wallet removed', 'success');
        void loadCryptoSettings();
      }
    } catch {
      addToast('Failed to remove wallet', 'error');
    } finally {
      setIsCryptoSaving(false);
    }
  };

  const handleSaveEtherscanKey = async () => {
    if (!newEtherscanKey) return;
    setIsCryptoSaving(true);
    try {
      const res = await fetch(`${API_BASE}/crypto/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ etherscanKey: newEtherscanKey }),
      });
      if ((await res.json()).ok) {
        addToast('Etherscan key saved', 'success');
        setNewEtherscanKey('');
        void loadCryptoSettings();
      }
    } catch {
      addToast('Failed to save Etherscan key', 'error');
    } finally {
      setIsCryptoSaving(false);
    }
  };

  const handleRemoveEtherscanKey = async () => {
    setIsCryptoSaving(true);
    try {
      const res = await fetch(`${API_BASE}/crypto/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ etherscanKey: '' }),
      });
      if ((await res.json()).ok) {
        addToast('Etherscan key removed', 'success');
        void loadCryptoSettings();
      }
    } catch {
      addToast('Failed to remove Etherscan key', 'error');
    } finally {
      setIsCryptoSaving(false);
    }
  };

  const loadSchedules = async () => {
    try {
      const res = await fetch(`${API_BASE}/schedules`);
      if (res.ok) {
        const data = await res.json();
        setSnapshotEnabled(data.snapshotEnabled);
        setSnapshotInterval(data.snapshotIntervalMinutes);
        setDropboxSyncEnabled(data.dropboxSyncEnabled);
        setDropboxSyncInterval(data.dropboxSyncIntervalMinutes);
        setAutoBackupPasswordSet(data.backupPasswordSet ?? false);
      }
    } catch {
      // Use defaults
    }
  };

  const handleSaveSchedules = async () => {
    setIsScheduleSaving(true);
    try {
      const res = await fetch(`${API_BASE}/schedules`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          snapshotEnabled,
          snapshotIntervalMinutes: snapshotInterval,
          dropboxSyncEnabled,
          dropboxSyncIntervalMinutes: dropboxSyncInterval,
          ...(autoBackupPassword ? { backupPassword: autoBackupPassword } : {}),
        }),
      });
      if (res.ok) {
        addToast('Schedules updated', 'success');
        setScheduleSaved(true);
        if (autoBackupPassword) {
          setAutoBackupPasswordSet(true);
          setAutoBackupPassword('');
        }
        setTimeout(() => setScheduleSaved(false), 2000);
      } else {
        addToast('Failed to save schedules', 'error');
      }
    } catch {
      addToast('Failed to save schedules', 'error');
    } finally {
      setIsScheduleSaving(false);
    }
  };

  // SimpleFIN functions
  const loadSimplefinStatus = async () => {
    try {
      const res = await fetch(`${API_BASE}/simplefin/status`);
      const data = await res.json();
      setSimplefinConfigured(data.configured);
    } catch {
      // Silently fail
    }
  };

  const handleSaveSimplefin = async () => {
    if (!simplefinToken) return;
    setIsSimplefinSaving(true);
    try {
      const res = await fetch(`${API_BASE}/simplefin/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ setupToken: simplefinToken }),
      });
      const data = await res.json();
      if (data.ok) {
        addToast('SimpleFIN connected', 'success');
        setSimplefinConfigured(true);
        setSimplefinToken('');
      } else {
        addToast(data.error || 'Failed to connect', 'error');
      }
    } catch {
      addToast('Failed to connect SimpleFIN', 'error');
    } finally {
      setIsSimplefinSaving(false);
    }
  };

  const handleRemoveSimplefin = async () => {
    if (!confirm('Remove SimpleFIN and disconnect all bank accounts?')) return;
    try {
      const res = await fetch(`${API_BASE}/simplefin`, { method: 'DELETE' });
      if ((await res.json()).ok) {
        addToast('SimpleFIN removed', 'success');
        setSimplefinConfigured(false);
      }
    } catch {
      addToast('Failed to remove SimpleFIN', 'error');
    }
  };

  // SnapTrade functions
  const loadSnapTradeStatus = async () => {
    try {
      const res = await fetch(`${API_BASE}/snaptrade/status`);
      if (res.ok) setSnapTradeStatus(await res.json());
    } catch {
      // Non-critical
    }
  };

  const handleSnapTradeSetup = async () => {
    if (!snapTradeClientId || !snapTradeConsumerKey) return;
    setIsSnapTradeSaving(true);
    try {
      const res = await fetch(`${API_BASE}/snaptrade/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: snapTradeClientId, consumerKey: snapTradeConsumerKey }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Setup failed');
      addToast('SnapTrade connected', 'success');
      setSnapTradeStatus({ configured: true, registered: true });
      setSnapTradeClientId('');
      setSnapTradeConsumerKey('');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'SnapTrade setup failed', 'error');
    } finally {
      setIsSnapTradeSaving(false);
    }
  };

  const handleRemoveSnapTrade = async () => {
    if (!confirm('Disconnect SnapTrade? This will remove all synced brokerage accounts.')) return;
    try {
      await fetch(`${API_BASE}/snaptrade`, { method: 'DELETE' });
      addToast('SnapTrade disconnected', 'success');
      setSnapTradeStatus({ configured: false, registered: false });
    } catch {
      addToast('Failed to disconnect SnapTrade', 'error');
    }
  };

  // Backup / Restore state
  const [backupPassword, setBackupPassword] = useState('');
  const [restorePassword, setRestorePassword] = useState('');
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [isDownloadingLatest, setIsDownloadingLatest] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);

  const handleBackup = async () => {
    if (!backupPassword || backupPassword.length < 4) {
      addToast('Password must be at least 4 characters', 'error');
      return;
    }
    setIsBackingUp(true);
    try {
      const res = await fetch(`${API_BASE}/backup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: backupPassword }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Backup failed');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `docvault-backup-${new Date().toISOString().split('T')[0]}.enc`;
      a.click();
      URL.revokeObjectURL(url);
      setBackupPassword('');
      addToast('Backup downloaded', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Backup failed', 'error');
    } finally {
      setIsBackingUp(false);
    }
  };

  const handleDownloadLatestBackup = async () => {
    setIsDownloadingLatest(true);
    try {
      const res = await fetch(`${API_BASE}/backup/latest`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Download failed');
      }
      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') || '';
      const match = disposition.match(/filename="(.+)"/);
      const filename = match?.[1] || `docvault-backup-latest.enc`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      addToast('Backup downloaded', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Download failed', 'error');
    } finally {
      setIsDownloadingLatest(false);
    }
  };

  const handleRestore = async () => {
    if (!restoreFile || !restorePassword) {
      addToast('Select a backup file and enter the password', 'error');
      return;
    }
    if (!confirm('This will overwrite all current settings and data. Continue?')) return;
    setIsRestoring(true);
    try {
      const form = new FormData();
      form.append('password', restorePassword);
      form.append('file', restoreFile);
      const res = await fetch(`${API_BASE}/restore`, {
        method: 'POST',
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Restore failed');
      setRestorePassword('');
      setRestoreFile(null);
      addToast(`Restored ${data.restored?.length || 0} files. Reload to apply.`, 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Restore failed', 'error');
    } finally {
      setIsRestoring(false);
    }
  };

  const handleRemoveEntity = async (entity: EntityConfig) => {
    if (!confirm(`Remove "${entity.name}"? This won't delete files.`)) {
      return;
    }

    const success = await removeEntity(entity.id);
    if (success) {
      addToast(`Removed ${entity.name}`, 'success');
      if (selectedEntity === entity.id) {
        setSelectedEntity('personal');
      }
    } else {
      addToast('Failed to remove entity', 'error');
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 md:px-6 py-8">
      <h2 className="text-2xl font-bold text-surface-950 mb-8">Settings</h2>

      {/* ── AI & API Keys ──────────────────────────────── */}
      <p className="text-[10px] font-semibold text-surface-500 uppercase tracking-[0.15em] mb-2 mt-2 px-1">
        AI & API Keys
      </p>

      <Card variant="glass" className="p-6 mb-8">
        <h3 className="text-lg font-semibold text-surface-950 mb-4 flex items-center gap-2">
          <Key className="w-5 h-5" />
          API Configuration
        </h3>

        {isLoading ? (
          <div className="text-center py-4 text-surface-600">Loading...</div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="block text-[13px] font-medium text-surface-800 mb-2">
                Anthropic API Key
              </label>

              {hasKey && keySource === 'settings' ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
                    <CheckCircle className="w-5 h-5 text-emerald-400" />
                    <div className="flex-1">
                      <span className="text-[13px] text-emerald-400 font-medium">
                        Custom API key
                      </span>
                      {keyHint && (
                        <span className="text-[13px] text-emerald-400/70 ml-2 font-mono">
                          --------{keyHint}
                        </span>
                      )}
                    </div>
                    <Button
                      variant="ghost-danger"
                      size="xs"
                      onClick={handleClearKey}
                      disabled={isSaving}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              ) : hasKey && keySource === 'env' ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 p-3 bg-info-500/10 border border-info-500/20 rounded-xl">
                    <CheckCircle className="w-5 h-5 text-info-400" />
                    <div className="flex-1">
                      <span className="text-[13px] text-info-400 font-medium">
                        Environment variable
                      </span>
                      {keyHint && (
                        <span className="text-[13px] text-info-400/70 ml-2 font-mono">
                          --------{keyHint}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="relative">
                    <Input
                      type={showKey ? 'text' : 'password'}
                      value={anthropicKey}
                      onChange={(e) => setAnthropicKey(e.target.value)}
                      placeholder="Enter key to override..."
                      className="pr-10 text-[13px] font-mono"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => setShowKey(!showKey)}
                      className="absolute right-2 top-1/2 -translate-y-1/2"
                    >
                      {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="relative">
                    <Input
                      type={showKey ? 'text' : 'password'}
                      value={anthropicKey}
                      onChange={(e) => setAnthropicKey(e.target.value)}
                      placeholder="sk-ant-..."
                      className="pr-10 text-[13px] font-mono"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => setShowKey(!showKey)}
                      className="absolute right-2 top-1/2 -translate-y-1/2"
                    >
                      {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </Button>
                  </div>
                  <p className="text-[11px] text-surface-600">
                    Get your API key at{' '}
                    <a
                      href="https://console.anthropic.com/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent-400 hover:underline"
                    >
                      console.anthropic.com
                    </a>
                  </p>
                </div>
              )}
            </div>

            {/* Save button */}
            {anthropicKey && (
              <Button onClick={handleSaveKey} disabled={isSaving}>
                <Save className="w-4 h-4" />
                {isSaving ? 'Saving...' : 'Save'}
              </Button>
            )}

            {/* Status messages */}
            {saveStatus === 'success' && (
              <div className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
                <CheckCircle className="w-5 h-5 text-emerald-400" />
                <span className="text-[13px] text-emerald-400">Settings saved successfully</span>
              </div>
            )}
            {saveStatus === 'error' && (
              <div className="flex items-center gap-2 p-3 bg-danger-500/10 border border-danger-500/20 rounded-xl">
                <AlertCircle className="w-5 h-5 text-danger-400" />
                <span className="text-[13px] text-danger-400">Failed to save settings</span>
              </div>
            )}

            {/* Model Selector */}
            <div className="pt-2 border-t border-border/30">
              <label className="block text-[13px] font-medium text-surface-800 mb-2">
                Claude Model
              </label>
              <Input
                type="text"
                value={claudeModel}
                onChange={(e) => setClaudeModel(e.target.value)}
                onBlur={() => handleSaveModel(claudeModel)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleSaveModel(claudeModel);
                }}
                placeholder="claude-sonnet-4-6"
                className="text-[13px] font-mono"
              />
              <p className="text-[11px] text-surface-500 mt-1">
                Used for document parsing and filename suggestions. Saves on blur or Enter.
              </p>
            </div>

            {/* Geoapify API Key */}
            <div className="pt-2 border-t border-border/30">
              <label className="block text-[13px] font-medium text-surface-800 mb-2">
                Geoapify API Key{' '}
                <span className="text-surface-500 font-normal">
                  (for mileage address autocomplete &mdash;{' '}
                  <a
                    href="https://myprojects.geoapify.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent-400 hover:underline"
                  >
                    get one free
                  </a>
                  )
                </span>
              </label>
              {hasGeoapifyKey ? (
                <div className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
                  <CheckCircle className="w-4 h-4 text-emerald-400" />
                  <span className="text-[13px] text-emerald-400 font-medium flex-1">
                    Key set
                    {geoapifyKeyHint && (
                      <span className="text-emerald-400/70 ml-2 font-mono">
                        ****{geoapifyKeyHint}
                      </span>
                    )}
                  </span>
                  <Button
                    variant="ghost-danger"
                    size="xs"
                    onClick={handleRemoveGeoapifyKey}
                    disabled={isSaving}
                  >
                    Remove
                  </Button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Input
                    type="password"
                    value={newGeoapifyKey}
                    onChange={(e) => setNewGeoapifyKey(e.target.value)}
                    placeholder="Geoapify API key..."
                    className="flex-1 text-[13px] font-mono"
                  />
                  <Button onClick={handleSaveGeoapifyKey} disabled={isSaving || !newGeoapifyKey}>
                    Save
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
      </Card>

      {/* ── Sync & Scheduling ─────────────────────────── */}
      <p className="text-[10px] font-semibold text-surface-500 uppercase tracking-[0.15em] mb-2 mt-2 px-1">
        Sync & Scheduling
      </p>

      {/* Sync Status */}
      <Card variant="glass" className="p-6 mb-8">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-surface-950 flex items-center gap-2">
            <RefreshCw className="w-5 h-5" />
            Sync Status
          </h3>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => {
              void loadSyncStatus();
              void loadCacheStatus();
            }}
            title="Refresh all"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
        </div>

        <div className="space-y-3">
          {/* Dropbox Sync */}
          <div
            className={`flex items-center gap-3 p-4 rounded-xl border ${
              syncStatus === null || syncStatus.status === 'unknown'
                ? 'bg-surface-200/30 border-surface-400/20'
                : syncStatus.status === 'ok'
                  ? 'bg-emerald-500/8 border-emerald-500/20'
                  : syncStatus.status === 'syncing'
                    ? 'bg-blue-500/8 border-blue-500/20'
                    : syncStatus.status === 'error'
                      ? 'bg-red-500/10 border-red-500/25'
                      : 'bg-surface-200/30 border-surface-400/20'
            }`}
          >
            <Cloud className="w-4 h-4 flex-shrink-0 text-surface-600" />
            <div
              className={`w-2 h-2 rounded-full flex-shrink-0 ${
                syncStatus === null || syncStatus.status === 'unknown'
                  ? 'bg-surface-500'
                  : syncStatus.status === 'ok'
                    ? 'bg-emerald-400'
                    : syncStatus.status === 'syncing'
                      ? 'bg-blue-400 animate-pulse'
                      : syncStatus.status === 'error'
                        ? 'bg-red-400'
                        : 'bg-surface-500'
              }`}
            />
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium text-surface-900">Dropbox</p>
              <p className="text-[11px] text-surface-600">
                {syncStatus === null || syncStatus.status === 'unknown'
                  ? 'Not configured'
                  : syncStatus.status === 'syncing'
                    ? 'Syncing...'
                    : syncStatus.status === 'error'
                      ? `${syncStatus.errors} error${syncStatus.errors !== 1 ? 's' : ''}`
                      : syncStatus.lastSync
                        ? formatRelativeTime(syncStatus.lastSync)
                        : 'No sync yet'}
                {syncStatus?.status === 'ok' && syncStatus.entitiesSynced > 0 && (
                  <span className="text-surface-500"> · {syncStatus.entitiesSynced} entities</span>
                )}
              </p>
            </div>
            {syncStatus?.nextSync && (
              <p className="text-[11px] text-surface-500 flex-shrink-0">
                Next: {formatRelativeTime(syncStatus.nextSync)}
              </p>
            )}
          </div>

          {/* Crypto Sync */}
          <div
            className={`flex items-center gap-3 p-4 rounded-xl border ${
              cryptoLastUpdated
                ? 'bg-emerald-500/8 border-emerald-500/20'
                : 'bg-surface-200/30 border-surface-400/20'
            }`}
          >
            <Bitcoin className="w-4 h-4 flex-shrink-0 text-surface-600" />
            <div
              className={`w-2 h-2 rounded-full flex-shrink-0 ${
                cryptoLastUpdated ? 'bg-emerald-400' : 'bg-surface-500'
              }`}
            />
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium text-surface-900">Crypto</p>
              <p className="text-[11px] text-surface-600">
                {cryptoLastUpdated ? formatRelativeTime(cryptoLastUpdated) : 'Never fetched'}
              </p>
            </div>
          </div>

          {/* Broker Sync */}
          <div
            className={`flex items-center gap-3 p-4 rounded-xl border ${
              brokerLastUpdated
                ? 'bg-emerald-500/8 border-emerald-500/20'
                : 'bg-surface-200/30 border-surface-400/20'
            }`}
          >
            <Building2 className="w-4 h-4 flex-shrink-0 text-surface-600" />
            <div
              className={`w-2 h-2 rounded-full flex-shrink-0 ${
                brokerLastUpdated ? 'bg-emerald-400' : 'bg-surface-500'
              }`}
            />
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium text-surface-900">Brokers</p>
              <p className="text-[11px] text-surface-600">
                {brokerLastUpdated ? formatRelativeTime(brokerLastUpdated) : 'Never fetched'}
              </p>
            </div>
          </div>

          {/* Bank Account Sync */}
          <div
            className={`flex items-center gap-3 p-4 rounded-xl border ${
              bankLastUpdated
                ? 'bg-emerald-500/8 border-emerald-500/20'
                : 'bg-surface-200/30 border-surface-400/20'
            }`}
          >
            <Landmark className="w-4 h-4 flex-shrink-0 text-surface-600" />
            <div
              className={`w-2 h-2 rounded-full flex-shrink-0 ${
                bankLastUpdated ? 'bg-emerald-400' : 'bg-surface-500'
              }`}
            />
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium text-surface-900">Bank Accounts</p>
              <p className="text-[11px] text-surface-600">
                {bankLastUpdated ? formatRelativeTime(bankLastUpdated) : 'Not connected'}
              </p>
            </div>
          </div>
        </div>
      </Card>

      {/* Scheduled Tasks */}
      <Card variant="glass" className="p-6 mb-8">
        <h3 className="text-lg font-semibold text-surface-950 mb-4 flex items-center gap-2">
          <RefreshCw className="w-5 h-5" />
          Scheduled Tasks
        </h3>
        <p className="text-[13px] text-surface-600 mb-4">
          Configure automatic portfolio snapshots and Dropbox sync intervals. Changes take effect
          immediately.
        </p>

        <div className="space-y-4">
          {/* Portfolio Snapshots */}
          <div className="p-4 bg-surface-200/20 rounded-xl border border-border/30">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-[13px] font-medium text-surface-900">Portfolio Snapshots</p>
                <p className="text-[11px] text-surface-500">
                  Saves daily portfolio value for the history chart
                </p>
              </div>
              <button
                onClick={() => setSnapshotEnabled(!snapshotEnabled)}
                className={`relative w-10 h-5 rounded-full transition-colors ${snapshotEnabled ? 'bg-violet-500' : 'bg-surface-400'}`}
              >
                <span
                  className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${snapshotEnabled ? 'left-5.5 translate-x-0' : 'left-0.5'}`}
                  style={{ left: snapshotEnabled ? 22 : 2 }}
                />
              </button>
            </div>
            {snapshotEnabled && (
              <div className="flex items-center gap-2">
                <label className="text-[12px] text-surface-600">Every</label>
                <Select
                  value={String(snapshotInterval)}
                  onValueChange={(val) => setSnapshotInterval(Number(val))}
                >
                  <SelectTrigger className="text-[13px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="60">1 hour</SelectItem>
                    <SelectItem value="360">6 hours</SelectItem>
                    <SelectItem value="720">12 hours</SelectItem>
                    <SelectItem value="1440">24 hours</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* Dropbox Sync */}
          <div className="p-4 bg-surface-200/20 rounded-xl border border-border/30">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-[13px] font-medium text-surface-900">Dropbox Sync</p>
                <p className="text-[11px] text-surface-500">Runs sync-to-dropbox.sh via rclone</p>
              </div>
              <button
                onClick={() => setDropboxSyncEnabled(!dropboxSyncEnabled)}
                className={`relative w-10 h-5 rounded-full transition-colors ${dropboxSyncEnabled ? 'bg-violet-500' : 'bg-surface-400'}`}
              >
                <span
                  className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform"
                  style={{ left: dropboxSyncEnabled ? 22 : 2 }}
                />
              </button>
            </div>
            {dropboxSyncEnabled && (
              <div className="flex items-center gap-2">
                <label className="text-[12px] text-surface-600">Every</label>
                <Select
                  value={String(dropboxSyncInterval)}
                  onValueChange={(val) => setDropboxSyncInterval(Number(val))}
                >
                  <SelectTrigger className="text-[13px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="5">5 minutes</SelectItem>
                    <SelectItem value="15">15 minutes</SelectItem>
                    <SelectItem value="30">30 minutes</SelectItem>
                    <SelectItem value="60">1 hour</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* Encrypted Config Backup */}
          <div className="border-t border-border pt-4">
            <p className="text-[13px] font-medium text-surface-900 mb-1">Encrypted Config Backup</p>
            <p className="text-[11px] text-surface-500 mb-3">
              Encrypts all config files and pushes to Dropbox on each sync.
              {autoBackupPasswordSet && !autoBackupPassword && (
                <span className="text-green-500 ml-1">Password configured.</span>
              )}
            </p>
            <input
              type="password"
              placeholder={
                autoBackupPasswordSet ? '••••••••  (leave blank to keep)' : 'Set backup password...'
              }
              value={autoBackupPassword}
              onChange={(e) => setAutoBackupPassword(e.target.value)}
              className="w-full px-3 py-2 bg-surface-200/30 border border-border rounded-lg text-[13px] text-surface-950 placeholder-surface-400 focus:outline-none focus:ring-2 focus:ring-violet-500/30"
            />
          </div>

          <Button
            onClick={handleSaveSchedules}
            disabled={isScheduleSaving}
            className="bg-violet-500 hover:bg-violet-400"
          >
            {scheduleSaved ? (
              <>
                <CheckCircle className="w-4 h-4" />
                Saved
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                {isScheduleSaving ? 'Saving...' : 'Save Schedules'}
              </>
            )}
          </Button>
        </div>
      </Card>

      {/* ── Integrations ─────────────────────────────────── */}
      <p className="text-[10px] font-semibold text-surface-500 uppercase tracking-[0.15em] mb-2 mt-2 px-1">
        Integrations
      </p>

      {/* Dropbox Connection */}
      <DropboxConnectionSection />

      {/* SimpleFIN Bank Accounts */}
      <Card variant="glass" className="p-6 mb-8">
        <h3 className="text-lg font-semibold text-surface-950 mb-4 flex items-center gap-2">
          <Landmark className="w-5 h-5" />
          Bank Accounts (SimpleFIN)
        </h3>
        <p className="text-[13px] text-surface-600 mb-4">
          Connect bank accounts (checking, savings, credit cards) via SimpleFIN Bridge. $15/year,
          supports 16,000+ US institutions. Get a setup token at{' '}
          <a
            href="https://beta-bridge.simplefin.org/simplefin/create"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent-400 hover:underline inline-flex items-center gap-1"
          >
            beta-bridge.simplefin.org
            <ExternalLink className="w-3 h-3" />
          </a>
        </p>

        {simplefinConfigured ? (
          <div className="space-y-3">
            <div className="flex items-center gap-3 p-4 bg-emerald-500/8 border border-emerald-500/20 rounded-xl">
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
              <div className="flex-1">
                <p className="text-[13px] font-medium text-emerald-400">Connected</p>
                <p className="text-[11px] text-surface-600">
                  SimpleFIN Bridge is active. View balances in the Banks tab.
                </p>
              </div>
            </div>
            <Button variant="ghost-danger" size="xs" onClick={handleRemoveSimplefin}>
              Remove SimpleFIN
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-2">
              <label className="text-[12px] font-medium text-surface-700">Setup Token</label>
              <input
                type="text"
                value={simplefinToken}
                onChange={(e) => setSimplefinToken(e.target.value)}
                placeholder="Paste your SimpleFIN setup token"
                className="w-full px-3 py-2.5 bg-surface-100 border border-border rounded-xl text-[13px] text-surface-900 placeholder-surface-500 outline-none focus:ring-2 focus:ring-accent-500/30 font-mono"
              />
              <p className="text-[11px] text-surface-500">
                1. Sign up at beta-bridge.simplefin.org ($15/year) 2. Connect your banks 3. Create a
                setup token and paste it here
              </p>
            </div>
            <Button
              onClick={handleSaveSimplefin}
              disabled={isSimplefinSaving || !simplefinToken}
              className="w-full"
            >
              {isSimplefinSaving ? 'Connecting...' : 'Connect SimpleFIN'}
            </Button>
          </div>
        )}
      </Card>

      {/* SnapTrade Brokerage Connection */}
      <Card variant="glass" className="p-6 mb-8">
        <h3 className="text-lg font-semibold text-surface-950 mb-4 flex items-center gap-2">
          <Key className="w-5 h-5" />
          Brokerage Sync (SnapTrade)
        </h3>
        <p className="text-[13px] text-surface-600 mb-4">
          Connect brokerage accounts (Vanguard, Fidelity, Robinhood, Chase, etc.) via SnapTrade to
          auto-sync holdings. Free tier supports 5 connections. Get API keys at{' '}
          <a
            href="https://dashboard.snaptrade.com/signup"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent-400 hover:underline inline-flex items-center gap-1"
          >
            dashboard.snaptrade.com
            <ExternalLink className="w-3 h-3" />
          </a>
        </p>

        {snapTradeStatus?.configured ? (
          <div className="space-y-3">
            <div className="flex items-center gap-3 p-4 bg-emerald-500/8 border border-emerald-500/20 rounded-xl">
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
              <div className="flex-1">
                <p className="text-[13px] font-medium text-emerald-400">Connected</p>
                <p className="text-[11px] text-surface-600">
                  SnapTrade is active. Manage linked brokerages in the Brokers tab.
                </p>
              </div>
            </div>
            <Button variant="ghost-danger" size="xs" onClick={handleRemoveSnapTrade}>
              Disconnect SnapTrade
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-2">
              <label className="text-[12px] font-medium text-surface-700">Client ID</label>
              <input
                type="text"
                value={snapTradeClientId}
                onChange={(e) => setSnapTradeClientId(e.target.value)}
                placeholder="Your SnapTrade Client ID"
                className="w-full px-3 py-2.5 bg-surface-100 border border-border rounded-xl text-[13px] text-surface-900 placeholder-surface-500 outline-none focus:ring-2 focus:ring-accent-500/30 font-mono"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[12px] font-medium text-surface-700">Consumer Key</label>
              <input
                type="password"
                value={snapTradeConsumerKey}
                onChange={(e) => setSnapTradeConsumerKey(e.target.value)}
                placeholder="Your SnapTrade Consumer Key"
                className="w-full px-3 py-2.5 bg-surface-100 border border-border rounded-xl text-[13px] text-surface-900 placeholder-surface-500 outline-none focus:ring-2 focus:ring-accent-500/30 font-mono"
              />
            </div>
            <Button
              onClick={handleSnapTradeSetup}
              disabled={isSnapTradeSaving || !snapTradeClientId || !snapTradeConsumerKey}
              className="w-full"
            >
              {isSnapTradeSaving ? 'Connecting...' : 'Connect SnapTrade'}
            </Button>
          </div>
        )}
      </Card>

      {/* Crypto Settings Section */}
      <Card variant="glass" className="p-6 mb-8">
        <h3 className="text-lg font-semibold text-surface-950 mb-4 flex items-center gap-2">
          <Bitcoin className="w-5 h-5" />
          Crypto Tracking
        </h3>
        <p className="text-[13px] text-surface-600 mb-4">
          Connect exchanges and wallets to track balances in the Crypto view.
        </p>

        {/* Exchanges */}
        <div className="mb-6">
          <h4 className="text-[13px] font-semibold text-surface-800 mb-3 flex items-center gap-2">
            <Key className="w-3.5 h-3.5" />
            Exchange API Keys
          </h4>

          <button
            onClick={() => setShowExchangeHelp(!showExchangeHelp)}
            className="flex items-center gap-1.5 text-[12px] text-accent-400 hover:text-accent-300 mb-3 transition-colors"
          >
            {showExchangeHelp ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            )}
            Where to get API keys
          </button>
          {showExchangeHelp && (
            <div className="p-3 bg-surface-200/20 border border-border rounded-xl mb-3 space-y-2.5">
              <div className="flex items-start gap-2">
                <span className="text-[12px] font-medium text-surface-800 min-w-[70px]">
                  Coinbase
                </span>
                <a
                  href="https://www.coinbase.com/settings/api"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[12px] text-accent-400 hover:underline flex items-center gap-1"
                >
                  coinbase.com/settings/api
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
              <p className="text-[11px] text-surface-500 ml-[78px] -mt-1">
                Create a CDP API key. You&apos;ll get an{' '}
                <span className="font-medium">API Key Name</span> and{' '}
                <span className="font-medium">Private Key</span> (PEM). Select view permissions
                only.
              </p>
              <div className="flex items-start gap-2">
                <span className="text-[12px] font-medium text-surface-800 min-w-[70px]">
                  Gemini
                </span>
                <a
                  href="https://exchange.gemini.com/settings/api"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[12px] text-accent-400 hover:underline flex items-center gap-1"
                >
                  exchange.gemini.com/settings/api
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
              <p className="text-[11px] text-surface-500 ml-[78px] -mt-1">
                Create a new API key. Select <span className="font-medium">Auditor</span> role for
                read-only access.
              </p>
              <div className="flex items-start gap-2">
                <span className="text-[12px] font-medium text-surface-800 min-w-[70px]">
                  Kraken
                </span>
                <a
                  href="https://pro.kraken.com/app/settings/api"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[12px] text-accent-400 hover:underline flex items-center gap-1"
                >
                  pro.kraken.com/app/settings/api
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
              <p className="text-[11px] text-surface-500 ml-[78px] -mt-1">
                Generate a new key with only <span className="font-medium">Query Funds</span>{' '}
                permission. No trading needed.
              </p>
            </div>
          )}

          {cryptoExchanges.length > 0 && (
            <div className="space-y-2 mb-3">
              {(showAllExchanges ? cryptoExchanges : cryptoExchanges.slice(0, 3)).map((ex) => (
                <div
                  key={ex.id}
                  className="flex items-center justify-between p-3 bg-surface-200/30 border border-surface-400/20 rounded-xl"
                >
                  <div className="flex items-center gap-2.5">
                    <div
                      className={`w-2 h-2 rounded-full ${ex.enabled ? 'bg-emerald-400' : 'bg-surface-500'}`}
                    />
                    <span className="text-[13px] font-medium text-surface-900 capitalize">
                      {ex.id}
                    </span>
                    {ex.keyHint && (
                      <span className="text-[11px] text-surface-500 font-mono">
                        ****{ex.keyHint}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => handleRemoveExchange(ex.id)}
                    disabled={isCryptoSaving}
                    className="p-1.5 text-surface-600 hover:text-danger-400 hover:bg-danger-500/10 rounded-lg transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {cryptoExchanges.length > 3 && (
                <button
                  onClick={() => setShowAllExchanges(!showAllExchanges)}
                  className="flex items-center gap-1.5 text-[12px] text-accent-400 hover:text-accent-300 transition-colors"
                >
                  {showAllExchanges ? (
                    <ChevronUp className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5" />
                  )}
                  {showAllExchanges ? 'Show less' : `Show ${cryptoExchanges.length - 3} more`}
                </button>
              )}
            </div>
          )}

          {showAddExchange ? (
            <div className="p-4 bg-surface-200/20 border border-border rounded-xl space-y-3">
              <div>
                <label className="block text-[11px] font-medium text-surface-600 mb-1">
                  Exchange
                </label>
                <Select
                  value={newExchangeId}
                  onValueChange={(val) => setNewExchangeId(val as CryptoExchangeId)}
                >
                  <SelectTrigger className="w-full text-[13px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="coinbase">Coinbase</SelectItem>
                    <SelectItem value="gemini">Gemini</SelectItem>
                    <SelectItem value="kraken">Kraken</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-surface-600 mb-1">
                  {newExchangeId === 'coinbase' ? 'API Key Name' : 'API Key'}
                </label>
                <input
                  type="password"
                  value={newExchangeKey}
                  onChange={(e) => setNewExchangeKey(e.target.value)}
                  placeholder={
                    newExchangeId === 'coinbase' ? 'organizations/…/apiKeys/…' : 'API key...'
                  }
                  className="w-full px-3 py-2 bg-surface-200/50 border border-border rounded-xl text-[13px] text-surface-900 font-mono placeholder:text-surface-500"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-surface-600 mb-1">
                  {newExchangeId === 'coinbase' ? 'Private Key' : 'API Secret'}
                </label>
                <textarea
                  value={newExchangeSecret}
                  onChange={(e) => setNewExchangeSecret(e.target.value)}
                  placeholder={
                    newExchangeId === 'coinbase'
                      ? '-----BEGIN EC PRIVATE KEY-----\n...'
                      : 'API secret...'
                  }
                  rows={newExchangeId === 'coinbase' ? 4 : 1}
                  className="w-full px-3 py-2 bg-surface-200/50 border border-border rounded-xl text-[13px] text-surface-900 font-mono placeholder:text-surface-500 resize-none"
                />
              </div>
              <div className="flex gap-2 pt-1">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setShowAddExchange(false);
                    setNewExchangeKey('');
                    setNewExchangeSecret('');
                    setNewExchangePassphrase('');
                  }}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleAddExchange}
                  disabled={isCryptoSaving || !newExchangeKey || !newExchangeSecret}
                >
                  {isCryptoSaving ? 'Saving...' : 'Add Exchange'}
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="ghost" onClick={() => setShowAddExchange(true)}>
              <Plus className="w-3.5 h-3.5" />
              Add Exchange
            </Button>
          )}
        </div>

        {/* Wallets */}
        <div>
          <h4 className="text-[13px] font-semibold text-surface-800 mb-3 flex items-center gap-2">
            <Wallet className="w-3.5 h-3.5" />
            Wallet Addresses
          </h4>

          <button
            onClick={() => setShowWalletHelp(!showWalletHelp)}
            className="flex items-center gap-1.5 text-[12px] text-accent-400 hover:text-accent-300 mb-3 transition-colors"
          >
            {showWalletHelp ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            )}
            How to find your wallet address
          </button>
          {showWalletHelp && (
            <div className="p-3 bg-surface-200/20 border border-border rounded-xl mb-3 space-y-2.5">
              <div>
                <p className="text-[12px] font-medium text-surface-800 mb-1">Bitcoin (BTC)</p>
                <p className="text-[11px] text-surface-600">
                  Your BTC address starts with <span className="font-mono">bc1q...</span>,{' '}
                  <span className="font-mono">1...</span>, or{' '}
                  <span className="font-mono">3...</span>. Find it in your wallet app under
                  &quot;Receive&quot;. You can verify it on{' '}
                  <a
                    href="https://blockstream.info/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent-400 hover:underline inline-flex items-center gap-0.5"
                  >
                    blockstream.info
                    <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                </p>
              </div>
              <div>
                <p className="text-[12px] font-medium text-surface-800 mb-1">Ethereum (ETH)</p>
                <p className="text-[11px] text-surface-600">
                  Your ETH address starts with <span className="font-mono">0x...</span> (42
                  characters). Find it in MetaMask, Ledger, or any Ethereum wallet. Verify on{' '}
                  <a
                    href="https://etherscan.io/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent-400 hover:underline inline-flex items-center gap-0.5"
                  >
                    etherscan.io
                    <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                </p>
              </div>
              <p className="text-[11px] text-surface-500 italic">
                Wallet queries are read-only — no private keys needed. Blockchain data is public.
              </p>
            </div>
          )}

          {cryptoWallets.length > 0 && (
            <div className="space-y-2 mb-3">
              {(showAllWallets ? cryptoWallets : cryptoWallets.slice(0, 3)).map((w) => (
                <div
                  key={w.id}
                  className="flex items-center justify-between p-3 bg-surface-200/30 border border-surface-400/20 rounded-xl"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-mono font-bold text-surface-700 uppercase">
                        {w.chain}
                      </span>
                      <span className="text-[13px] font-medium text-surface-900">{w.label}</span>
                    </div>
                    <p className="text-[11px] text-surface-500 font-mono truncate">{w.address}</p>
                  </div>
                  <button
                    onClick={() => handleRemoveWallet(w.id)}
                    disabled={isCryptoSaving}
                    className="p-1.5 text-surface-600 hover:text-danger-400 hover:bg-danger-500/10 rounded-lg transition-colors flex-shrink-0 ml-2"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {cryptoWallets.length > 3 && (
                <button
                  onClick={() => setShowAllWallets(!showAllWallets)}
                  className="flex items-center gap-1.5 text-[12px] text-accent-400 hover:text-accent-300 transition-colors"
                >
                  {showAllWallets ? (
                    <ChevronUp className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5" />
                  )}
                  {showAllWallets ? 'Show less' : `Show ${cryptoWallets.length - 3} more`}
                </button>
              )}
            </div>
          )}

          {showAddWallet ? (
            <div className="p-4 bg-surface-200/20 border border-border rounded-xl space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-surface-600 mb-1">
                    Chain
                  </label>
                  <Select
                    value={newWalletChain}
                    onValueChange={(val) => setNewWalletChain(val as CryptoChain)}
                  >
                    <SelectTrigger className="w-full text-[13px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="btc">Bitcoin (BTC)</SelectItem>
                      <SelectItem value="eth">Ethereum (ETH)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-surface-600 mb-1">
                    Label
                  </label>
                  <input
                    type="text"
                    value={newWalletLabel}
                    onChange={(e) => setNewWalletLabel(e.target.value)}
                    placeholder="e.g. Cold storage"
                    className="w-full px-3 py-2 bg-surface-200/50 border border-border rounded-xl text-[13px] text-surface-900 placeholder:text-surface-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-surface-600 mb-1">
                  Address
                </label>
                <input
                  type="text"
                  value={newWalletAddress}
                  onChange={(e) => setNewWalletAddress(e.target.value)}
                  placeholder={newWalletChain === 'btc' ? 'bc1q... or 1A1zP1...' : '0x...'}
                  className="w-full px-3 py-2 bg-surface-200/50 border border-border rounded-xl text-[13px] text-surface-900 font-mono placeholder:text-surface-500"
                />
              </div>
              <div className="flex gap-2 pt-1">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setShowAddWallet(false);
                    setNewWalletAddress('');
                    setNewWalletLabel('');
                  }}
                >
                  Cancel
                </Button>
                <Button onClick={handleAddWallet} disabled={isCryptoSaving || !newWalletAddress}>
                  {isCryptoSaving ? 'Saving...' : 'Add Wallet'}
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="ghost" onClick={() => setShowAddWallet(true)}>
              <Plus className="w-3.5 h-3.5" />
              Add Wallet
            </Button>
          )}

          {/* Etherscan API Key */}
          <div className="mt-4 pt-4 border-t border-border">
            <label className="block text-[11px] font-medium text-surface-600 mb-2">
              Etherscan API Key{' '}
              <span className="text-surface-500 font-normal">
                (for ERC-20 token balances &mdash;{' '}
                <a
                  href="https://etherscan.io/myapikey"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent-400 hover:underline"
                >
                  get one free
                </a>
                )
              </span>
            </label>
            {hasEtherscanKey ? (
              <div className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
                <CheckCircle className="w-4 h-4 text-emerald-400" />
                <span className="text-[13px] text-emerald-400 font-medium flex-1">
                  Key set
                  {etherscanKeyHint && (
                    <span className="text-emerald-400/70 ml-2 font-mono">
                      ****{etherscanKeyHint}
                    </span>
                  )}
                </span>
                <Button
                  variant="ghost-danger"
                  size="xs"
                  onClick={handleRemoveEtherscanKey}
                  disabled={isCryptoSaving}
                >
                  Remove
                </Button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Input
                  type="password"
                  value={newEtherscanKey}
                  onChange={(e) => setNewEtherscanKey(e.target.value)}
                  placeholder="Etherscan API key..."
                  className="flex-1 text-[13px] font-mono"
                />
                <Button
                  onClick={handleSaveEtherscanKey}
                  disabled={isCryptoSaving || !newEtherscanKey}
                >
                  Save
                </Button>
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* ── Data Management ──────────────────────────────── */}
      <p className="text-[10px] font-semibold text-surface-500 uppercase tracking-[0.15em] mb-2 mt-2 px-1">
        Data Management
      </p>

      {/* Entity Management Section */}
      <Card variant="glass" className="p-6 mb-8">
        <h3 className="text-lg font-semibold text-surface-950 mb-4 flex items-center gap-2">
          <Building2 className="w-5 h-5" />
          Entity Management
        </h3>
        <p className="text-[13px] text-surface-600 mb-4">
          Manage your tax entities (personal, LLCs, etc.)
        </p>

        <div className="space-y-3">
          {(showAllEntities ? entities : entities.slice(0, 3)).map((entity) => {
            const Icon = getEntityIcon(entity);
            const colors = COLOR_MAP[entity.color] || COLOR_MAP.blue;
            const isEditing = editingEntity?.id === entity.id;
            const isPersonal = entity.id === 'personal';

            return (
              <div
                key={entity.id}
                className={`p-4 rounded-xl border ${isEditing ? 'border-accent-400/30 bg-accent-500/5' : `${colors.border} ${colors.bg}`}`}
              >
                {isEditing ? (
                  <div className="space-y-4">
                    {/* Edit Name */}
                    <div>
                      <label className="block text-[11px] font-medium text-surface-600 mb-1">
                        Name
                      </label>
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="w-full px-3 py-2.5 bg-surface-200/50 border border-border rounded-xl text-[13px] text-surface-900"
                      />
                    </div>

                    {/* Edit Description */}
                    <div>
                      <label className="block text-[11px] font-medium text-surface-600 mb-1">
                        Description
                      </label>
                      <textarea
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                        placeholder="What documents does this entity contain? Notes for tax planning..."
                        rows={2}
                        className="w-full px-3 py-2.5 bg-surface-200/50 border border-border rounded-xl text-[13px] text-surface-900 resize-none placeholder:text-surface-500"
                      />
                    </div>

                    {/* Edit Icon */}
                    <div>
                      <label className="block text-[11px] font-medium text-surface-600 mb-2">
                        Icon
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {AVAILABLE_ICONS.map(({ id, icon: IconComp, label }) => {
                          const iconColors = COLOR_MAP[editColor] || COLOR_MAP.blue;
                          return (
                            <button
                              key={id}
                              onClick={() => setEditIcon(id)}
                              title={label}
                              className={`p-2 rounded-lg border-2 transition-all ${
                                editIcon === id
                                  ? `${iconColors.bg} ${iconColors.border} ${iconColors.text}`
                                  : 'bg-surface-200/30 border-border text-surface-600 hover:border-surface-500'
                              }`}
                            >
                              <IconComp className="w-4 h-4" />
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Edit Color */}
                    <div>
                      <label className="block text-[11px] font-medium text-surface-600 mb-2">
                        Color
                      </label>
                      <div className="flex gap-2.5">
                        {AVAILABLE_COLORS.map((color) => {
                          const colorStyles = COLOR_MAP[color];
                          return (
                            <button
                              key={color}
                              onClick={() => setEditColor(color)}
                              className={`w-8 h-8 rounded-full ${colorStyles.bg} ${colorStyles.border} border-2 transition-all duration-150 ${
                                editColor === color
                                  ? 'ring-2 ring-offset-2 ring-offset-surface-100 ' +
                                    colorStyles.ring
                                  : ''
                              }`}
                            />
                          );
                        })}
                      </div>
                    </div>

                    {/* Edit Actions */}
                    <div className="flex gap-2 pt-2">
                      <Button variant="ghost" onClick={handleCancelEdit}>
                        Cancel
                      </Button>
                      <Button onClick={handleSaveEntity} disabled={isEntitySaving}>
                        {isEntitySaving ? 'Saving...' : 'Save Changes'}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-lg ${colors.bg}`}>
                        <Icon className={`w-5 h-5 ${colors.text}`} />
                      </div>
                      <div>
                        <p className={`font-medium ${colors.text}`}>{entity.name}</p>
                        <p className="text-[11px] text-surface-600">{entity.id}</p>
                        {entity.description && (
                          <p className="text-[11px] text-surface-500 mt-0.5">
                            {entity.description}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {isPersonal && (
                        <span className="text-[11px] text-surface-500 italic mr-2">Default</span>
                      )}
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => handleEditEntity(entity)}
                        title="Edit entity"
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      {!isPersonal && (
                        <Button
                          variant="ghost-danger"
                          size="icon-sm"
                          onClick={() => handleRemoveEntity(entity)}
                          title="Remove entity"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {entities.length > 3 && (
            <button
              onClick={() => setShowAllEntities(!showAllEntities)}
              className="flex items-center gap-1.5 text-[12px] text-accent-400 hover:text-accent-300 transition-colors mt-2"
            >
              {showAllEntities ? (
                <ChevronUp className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
              {showAllEntities ? 'Show less' : `Show ${entities.length - 3} more`}
            </button>
          )}
        </div>
      </Card>

      {/* Backup & Restore */}
      <Card variant="glass" className="p-6 mb-8">
        <h3 className="text-lg font-semibold text-surface-950 mb-2 flex items-center gap-2">
          <Shield className="w-5 h-5" />
          Encrypted Backup
        </h3>
        <p className="text-[13px] text-surface-600 mb-5">
          AES-256 encrypted backup of all settings, API keys, cached data, and portfolio snapshots.{' '}
          {autoBackupPasswordSet ? (
            <span className="text-green-500">
              Auto-backup is enabled and syncs to Dropbox every cycle.
            </span>
          ) : (
            <span className="text-surface-500">
              Set a backup password in Schedules above to auto-sync encrypted backups to Dropbox.
            </span>
          )}
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Download Latest Auto-Backup */}
          <div className="p-4 bg-surface-200/20 rounded-xl border border-border/30 flex flex-col">
            <h4 className="text-[13px] font-semibold text-surface-900 mb-3 flex items-center gap-1.5">
              <Cloud className="w-4 h-4" />
              Download Latest
            </h4>
            <p className="text-[11px] text-surface-500 mb-3">
              Download the most recent auto-generated backup. Uses the password set in Schedules.
            </p>
            <div className="mt-auto">
              <Button
                onClick={handleDownloadLatestBackup}
                disabled={isDownloadingLatest}
                className="w-full bg-violet-500 hover:bg-violet-400"
              >
                <Download className="w-4 h-4" />
                {isDownloadingLatest ? 'Downloading...' : 'Download Latest'}
              </Button>
            </div>
          </div>

          {/* Manual Backup */}
          <div className="p-4 bg-surface-200/20 rounded-xl border border-border/30 flex flex-col">
            <h4 className="text-[13px] font-semibold text-surface-900 mb-3 flex items-center gap-1.5">
              <Download className="w-4 h-4" />
              Manual Backup
            </h4>
            <div className="space-y-2 mt-auto">
              <Input
                type="password"
                value={backupPassword}
                onChange={(e) => setBackupPassword(e.target.value)}
                placeholder="Encryption password (min 4 chars)"
                className="text-[13px] rounded-lg"
              />
              <Button
                onClick={handleBackup}
                disabled={isBackingUp || backupPassword.length < 4}
                className="w-full bg-violet-500 hover:bg-violet-400"
              >
                <Download className="w-4 h-4" />
                {isBackingUp ? 'Encrypting...' : 'Create & Download'}
              </Button>
            </div>
          </div>

          {/* Restore */}
          <div className="p-4 bg-surface-200/20 rounded-xl border border-border/30 flex flex-col">
            <h4 className="text-[13px] font-semibold text-surface-900 mb-3 flex items-center gap-1.5">
              <Upload className="w-4 h-4" />
              Restore Backup
            </h4>
            <div className="space-y-2 mt-auto">
              <input
                type="file"
                accept=".enc"
                onChange={(e) => setRestoreFile(e.target.files?.[0] || null)}
                className="w-full text-[12px] text-surface-700 file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-[12px] file:font-medium file:bg-surface-200/50 file:text-surface-700 hover:file:bg-surface-300/50"
              />
              <Input
                type="password"
                value={restorePassword}
                onChange={(e) => setRestorePassword(e.target.value)}
                placeholder="Backup password"
                className="text-[13px] rounded-lg"
              />
              <Button
                onClick={handleRestore}
                disabled={isRestoring || !restoreFile || !restorePassword}
                className="w-full bg-amber-500 hover:bg-amber-400"
              >
                <Upload className="w-4 h-4" />
                {isRestoring ? 'Restoring...' : 'Restore from Backup'}
              </Button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
