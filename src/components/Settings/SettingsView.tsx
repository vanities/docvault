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
  ChevronRight,
  ExternalLink,
} from 'lucide-react';
import type { SyncStatus, CryptoExchangeId, CryptoChain } from '../../types';
import { useAppContext } from '../../contexts/AppContext';
import { useToast } from '../../hooks/useToast';
import type { EntityConfig } from '../../hooks/useFileSystemServer';
import { API_BASE } from '../../constants';
import {
  AVAILABLE_ICONS,
  DEFAULT_ENTITY_ICONS,
  getEntityIcon,
  SETTINGS_COLOR_MAP as COLOR_MAP,
  AVAILABLE_COLORS,
} from '../../utils/entityDisplay';

interface SettingsData {
  hasAnthropicKey: boolean;
  keySource?: 'settings' | 'env';
  keyHint?: string;
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
  const [keyHint, setKeyHint] = useState<string | undefined>();

  // Sync status state
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);

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

  // Load settings and sync status on mount
  useEffect(() => {
    loadSettings();
    loadSyncStatus();
    loadCryptoSettings();
    const interval = setInterval(loadSyncStatus, 30000); // Poll every 30s
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

  const loadSettings = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`${API_BASE}/settings`);
      const data: SettingsData = await response.json();
      setHasKey(data.hasAnthropicKey || false);
      setKeySource(data.keySource);
      setKeyHint(data.keyHint);
      setAnthropicKey('');
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
        loadCryptoSettings();
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
        loadCryptoSettings();
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
        loadCryptoSettings();
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
        loadCryptoSettings();
      }
    } catch {
      addToast('Failed to remove wallet', 'error');
    } finally {
      setIsCryptoSaving(false);
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

      {/* API Key Section */}
      <section className="glass-card rounded-xl p-6 mb-8">
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
                    <button
                      onClick={handleClearKey}
                      disabled={isSaving}
                      className="text-[13px] text-danger-400 hover:text-danger-300"
                    >
                      Remove
                    </button>
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
                    <input
                      type={showKey ? 'text' : 'password'}
                      value={anthropicKey}
                      onChange={(e) => setAnthropicKey(e.target.value)}
                      placeholder="Enter key to override..."
                      className="w-full px-3 py-2.5 pr-10 bg-surface-200/50 border border-border rounded-xl text-[13px] text-surface-900 font-mono placeholder:text-surface-500"
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey(!showKey)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-surface-600 hover:text-surface-800"
                    >
                      {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="relative">
                    <input
                      type={showKey ? 'text' : 'password'}
                      value={anthropicKey}
                      onChange={(e) => setAnthropicKey(e.target.value)}
                      placeholder="sk-ant-..."
                      className="w-full px-3 py-2.5 pr-10 bg-surface-200/50 border border-border rounded-xl text-[13px] text-surface-900 font-mono placeholder:text-surface-500"
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey(!showKey)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-surface-600 hover:text-surface-800"
                    >
                      {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
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
              <button
                onClick={handleSaveKey}
                disabled={isSaving}
                className="flex items-center gap-2 px-4 py-2.5 bg-accent-500 text-surface-0 rounded-xl hover:bg-accent-400 transition-colors disabled:opacity-50 text-[13px] font-medium"
              >
                <Save className="w-4 h-4" />
                {isSaving ? 'Saving...' : 'Save'}
              </button>
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
          </div>
        )}
      </section>

      {/* Dropbox Sync Status */}
      <section className="glass-card rounded-xl p-6 mb-8">
        <h3 className="text-lg font-semibold text-surface-950 mb-4 flex items-center gap-2">
          <Cloud className="w-5 h-5" />
          Dropbox Sync
        </h3>

        {syncStatus === null || syncStatus.status === 'unknown' ? (
          <div className="flex items-center gap-3 p-4 bg-surface-200/30 border border-surface-400/20 rounded-xl">
            <div className="w-2.5 h-2.5 rounded-full bg-surface-500" />
            <div>
              <p className="text-[13px] text-surface-700">Not configured</p>
              <p className="text-[11px] text-surface-500">
                Sync status file not found. Sync runs via cron on the NAS.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Status indicator */}
            <div
              className={`flex items-center gap-3 p-4 rounded-xl border ${
                syncStatus.status === 'ok'
                  ? 'bg-emerald-500/8 border-emerald-500/20'
                  : syncStatus.status === 'syncing'
                    ? 'bg-blue-500/8 border-blue-500/20'
                    : syncStatus.status === 'error'
                      ? 'bg-red-500/10 border-red-500/25'
                      : 'bg-surface-200/30 border-surface-400/20'
              }`}
            >
              <div
                className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                  syncStatus.status === 'ok'
                    ? 'bg-emerald-400'
                    : syncStatus.status === 'syncing'
                      ? 'bg-blue-400 animate-pulse'
                      : syncStatus.status === 'error'
                        ? 'bg-red-400'
                        : 'bg-surface-500'
                }`}
              />
              <div className="flex-1">
                <p
                  className={`text-[13px] font-medium ${
                    syncStatus.status === 'ok'
                      ? 'text-emerald-400'
                      : syncStatus.status === 'syncing'
                        ? 'text-blue-400'
                        : syncStatus.status === 'error'
                          ? 'text-red-400'
                          : 'text-surface-700'
                  }`}
                >
                  {syncStatus.status === 'ok'
                    ? 'Synced to Dropbox'
                    : syncStatus.status === 'syncing'
                      ? 'Syncing...'
                      : syncStatus.status === 'error'
                        ? `Sync errors (${syncStatus.errors})`
                        : 'Unknown'}
                </p>
                {syncStatus.status === 'ok' && (
                  <p className="text-[11px] text-surface-600">
                    {syncStatus.entitiesSynced} entities synced
                  </p>
                )}
              </div>
              <button
                onClick={loadSyncStatus}
                className="p-1.5 rounded-lg hover:bg-surface-300/30 text-surface-600 hover:text-surface-800 transition-colors"
                title="Refresh status"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Timing details */}
            <div className="grid grid-cols-2 gap-3">
              {syncStatus.lastSync && (
                <div className="p-3 bg-surface-200/20 rounded-lg">
                  <p className="text-[11px] text-surface-500 mb-0.5">Last sync</p>
                  <p className="text-[13px] text-surface-800">
                    {formatRelativeTime(syncStatus.lastSync)}
                  </p>
                </div>
              )}
              {syncStatus.nextSync && (
                <div className="p-3 bg-surface-200/20 rounded-lg">
                  <p className="text-[11px] text-surface-500 mb-0.5">Next sync</p>
                  <p className="text-[13px] text-surface-800">
                    {formatRelativeTime(syncStatus.nextSync)}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Crypto Settings Section */}
      <section className="glass-card rounded-xl p-6 mb-8">
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
              {cryptoExchanges.map((ex) => (
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
            </div>
          )}

          {showAddExchange ? (
            <div className="p-4 bg-surface-200/20 border border-border rounded-xl space-y-3">
              <div>
                <label className="block text-[11px] font-medium text-surface-600 mb-1">
                  Exchange
                </label>
                <select
                  value={newExchangeId}
                  onChange={(e) => setNewExchangeId(e.target.value as CryptoExchangeId)}
                  className="w-full px-3 py-2 bg-surface-200/50 border border-border rounded-xl text-[13px] text-surface-900"
                >
                  <option value="coinbase">Coinbase</option>
                  <option value="gemini">Gemini</option>
                  <option value="kraken">Kraken</option>
                </select>
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
                <button
                  onClick={() => {
                    setShowAddExchange(false);
                    setNewExchangeKey('');
                    setNewExchangeSecret('');
                    setNewExchangePassphrase('');
                  }}
                  className="px-3 py-2 text-[13px] text-surface-700 hover:bg-surface-300/30 rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddExchange}
                  disabled={isCryptoSaving || !newExchangeKey || !newExchangeSecret}
                  className="px-3 py-2 text-[13px] text-surface-0 bg-accent-500 hover:bg-accent-400 rounded-xl transition-colors disabled:opacity-50 font-medium"
                >
                  {isCryptoSaving ? 'Saving...' : 'Add Exchange'}
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowAddExchange(true)}
              className="flex items-center gap-2 px-3 py-2 text-[13px] text-surface-700 hover:text-surface-900 hover:bg-surface-200/50 rounded-xl transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Exchange
            </button>
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
              {cryptoWallets.map((w) => (
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
            </div>
          )}

          {showAddWallet ? (
            <div className="p-4 bg-surface-200/20 border border-border rounded-xl space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-surface-600 mb-1">
                    Chain
                  </label>
                  <select
                    value={newWalletChain}
                    onChange={(e) => setNewWalletChain(e.target.value as CryptoChain)}
                    className="w-full px-3 py-2 bg-surface-200/50 border border-border rounded-xl text-[13px] text-surface-900"
                  >
                    <option value="btc">Bitcoin (BTC)</option>
                    <option value="eth">Ethereum (ETH)</option>
                  </select>
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
                <button
                  onClick={() => {
                    setShowAddWallet(false);
                    setNewWalletAddress('');
                    setNewWalletLabel('');
                  }}
                  className="px-3 py-2 text-[13px] text-surface-700 hover:bg-surface-300/30 rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddWallet}
                  disabled={isCryptoSaving || !newWalletAddress}
                  className="px-3 py-2 text-[13px] text-surface-0 bg-accent-500 hover:bg-accent-400 rounded-xl transition-colors disabled:opacity-50 font-medium"
                >
                  {isCryptoSaving ? 'Saving...' : 'Add Wallet'}
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowAddWallet(true)}
              className="flex items-center gap-2 px-3 py-2 text-[13px] text-surface-700 hover:text-surface-900 hover:bg-surface-200/50 rounded-xl transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Wallet
            </button>
          )}
        </div>
      </section>

      {/* Entity Management Section */}
      <section className="glass-card rounded-xl p-6">
        <h3 className="text-lg font-semibold text-surface-950 mb-4 flex items-center gap-2">
          <Building2 className="w-5 h-5" />
          Entity Management
        </h3>
        <p className="text-[13px] text-surface-600 mb-4">
          Manage your tax entities (personal, LLCs, etc.)
        </p>

        <div className="space-y-3">
          {entities.map((entity) => {
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
                      <button
                        onClick={handleCancelEdit}
                        className="px-3 py-2 text-[13px] text-surface-700 hover:bg-surface-300/30 rounded-xl transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleSaveEntity}
                        disabled={isEntitySaving}
                        className="px-3 py-2 text-[13px] text-surface-0 bg-accent-500 hover:bg-accent-400 rounded-xl transition-colors disabled:opacity-50 font-medium"
                      >
                        {isEntitySaving ? 'Saving...' : 'Save Changes'}
                      </button>
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
                      <button
                        onClick={() => handleEditEntity(entity)}
                        className="p-2 text-surface-600 hover:text-surface-800 hover:bg-surface-300/30 rounded-lg transition-colors"
                        title="Edit entity"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      {!isPersonal && (
                        <button
                          onClick={() => handleRemoveEntity(entity)}
                          className="p-2 text-surface-600 hover:text-danger-400 hover:bg-danger-500/10 rounded-lg transition-colors"
                          title="Remove entity"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
