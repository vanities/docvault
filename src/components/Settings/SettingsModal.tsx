import { useState, useEffect } from 'react';
import { Key, Save, Eye, EyeOff, CheckCircle, AlertCircle } from 'lucide-react';
import { API_BASE } from '../../constants';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface SettingsData {
  hasAnthropicKey: boolean;
  keySource?: 'settings' | 'env';
  keyHint?: string; // Last 4 chars of the key
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [anthropicKey, setAnthropicKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [hasKey, setHasKey] = useState(false);
  const [keySource, setKeySource] = useState<'settings' | 'env' | undefined>();
  const [keyHint, setKeyHint] = useState<string | undefined>();

  // Load current settings on mount
  useEffect(() => {
    if (isOpen) {
      void loadSettings();
    }
  }, [isOpen]);

  const loadSettings = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`${API_BASE}/settings`);
      const data: SettingsData = await response.json();
      setHasKey(data.hasAnthropicKey || false);
      setKeySource(data.keySource);
      setKeyHint(data.keyHint);
      // Don't load the actual key for security
      setAnthropicKey('');
    } catch (err) {
      console.error('Failed to load settings:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveStatus('idle');

    try {
      const response = await fetch(`${API_BASE}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          anthropicKey: anthropicKey || undefined,
        }),
      });

      const data = await response.json();
      if (data.ok) {
        setSaveStatus('success');
        setHasKey(true);
        setAnthropicKey('');
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
        setSaveStatus('success');
        setTimeout(() => setSaveStatus('idle'), 3000);
      }
    } catch (err) {
      console.error('Failed to clear key:', err);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Configure API keys and integration settings.</DialogDescription>
        </DialogHeader>

        {/* Content */}
        <div className="space-y-4">
          {isLoading ? (
            <div className="text-center py-8 text-surface-500">Loading...</div>
          ) : (
            <>
              {/* Anthropic API Key */}
              <div>
                <label className="block text-sm font-medium text-surface-700 mb-2">
                  <div className="flex items-center gap-2">
                    <Key className="w-4 h-4" />
                    Anthropic API Key
                  </div>
                </label>

                {hasKey && keySource === 'settings' ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
                      <CheckCircle className="w-5 h-5 text-green-600" />
                      <div className="flex-1">
                        <span className="text-sm text-green-700 font-medium">Custom API key</span>
                        {keyHint && (
                          <span className="text-sm text-green-600 ml-2 font-mono">
                            --------{keyHint}
                          </span>
                        )}
                      </div>
                      <button
                        onClick={handleClearKey}
                        disabled={isSaving}
                        className="text-sm text-red-600 hover:text-red-700"
                      >
                        Remove
                      </button>
                    </div>
                    <p className="text-xs text-surface-500">
                      This key overrides the environment variable
                    </p>
                  </div>
                ) : hasKey && keySource === 'env' ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                      <CheckCircle className="w-5 h-5 text-blue-600" />
                      <div className="flex-1">
                        <span className="text-sm text-blue-700 font-medium">
                          Environment variable
                        </span>
                        {keyHint && (
                          <span className="text-sm text-blue-600 ml-2 font-mono">
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
                        className="w-full px-3 py-2 pr-10 border border-border rounded-lg bg-surface-200/50 text-surface-900 focus:outline-none focus:ring-2 focus:ring-accent-500 font-mono text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => setShowKey(!showKey)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-surface-400 hover:text-surface-600"
                      >
                        {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    <p className="text-xs text-surface-500">
                      Add a key here to override the environment variable
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="relative">
                      <input
                        type={showKey ? 'text' : 'password'}
                        value={anthropicKey}
                        onChange={(e) => setAnthropicKey(e.target.value)}
                        placeholder="sk-ant-..."
                        className="w-full px-3 py-2 pr-10 border border-border rounded-lg bg-surface-200/50 text-surface-900 focus:outline-none focus:ring-2 focus:ring-accent-500 font-mono text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => setShowKey(!showKey)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-surface-400 hover:text-surface-600"
                      >
                        {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    <p className="text-xs text-surface-500">
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

              {/* Status message */}
              {saveStatus === 'success' && (
                <div className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
                  <CheckCircle className="w-5 h-5 text-green-600" />
                  <span className="text-sm text-green-700">Settings saved successfully</span>
                </div>
              )}
              {saveStatus === 'error' && (
                <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                  <AlertCircle className="w-5 h-5 text-red-600" />
                  <span className="text-sm text-red-700">Failed to save settings</span>
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={isSaving || !anthropicKey}
          >
            <Save className="w-4 h-4" />
            {isSaving ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
