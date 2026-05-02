// Chat & Voice settings — Claude OAuth subscription token + transcription
// service URL. Lives next to the API key card in the keys tab.
//
// The OAuth token is the alternative to an API key: the Anthropic SDK accepts
// it via `authToken` (Bearer) and routes through the user's Claude.ai
// subscription rather than API billing. Generate with `claude setup-token`.
//
// The transcription URL points at any OpenAI-compatible
// /audio/transcriptions service running on the user's NAS — whisper.cpp,
// faster-whisper-server, parakeet-mlx, lightning-whisper-mlx, etc. The
// `/api/transcribe` route appends `/v1/audio/transcriptions` if the user
// supplied just a host root.

import { useEffect, useState } from 'react';
import { CheckCircle, Eye, EyeOff, Key, Mic, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { useToast } from '../../hooks/useToast';
import { API_BASE } from '../../constants';

interface ChatSettingsData {
  hasAnthropicAuthToken?: boolean;
  authSource?: 'settings' | 'env';
  authHint?: string;
  transcribeUrl?: string;
  transcribeModel?: string;
}

export function ChatSettingsSection() {
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [hasAuth, setHasAuth] = useState(false);
  const [authSource, setAuthSource] = useState<'settings' | 'env' | undefined>();
  const [authHint, setAuthHint] = useState<string | undefined>();
  const [authInput, setAuthInput] = useState('');
  const [showAuth, setShowAuth] = useState(false);
  const [savingAuth, setSavingAuth] = useState(false);

  const [transcribeUrl, setTranscribeUrl] = useState('');
  const [transcribeModel, setTranscribeModel] = useState('');
  const [savingTranscribe, setSavingTranscribe] = useState(false);

  const loadData = async () => {
    try {
      const res = await fetch(`${API_BASE}/settings`);
      const data: ChatSettingsData = await res.json();
      setHasAuth(!!data.hasAnthropicAuthToken);
      setAuthSource(data.authSource);
      setAuthHint(data.authHint);
      setTranscribeUrl(data.transcribeUrl ?? '');
      setTranscribeModel(data.transcribeModel ?? '');
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const handleSaveAuth = async () => {
    if (!authInput.trim()) return;
    setSavingAuth(true);
    try {
      const res = await fetch(`${API_BASE}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ anthropicAuthToken: authInput.trim() }),
      });
      if ((await res.json()).ok) {
        addToast('Claude OAuth token saved', 'success');
        setAuthInput('');
        await loadData();
      } else {
        addToast('Failed to save token', 'error');
      }
    } catch {
      addToast('Failed to save token', 'error');
    } finally {
      setSavingAuth(false);
    }
  };

  const handleClearAuth = async () => {
    setSavingAuth(true);
    try {
      const res = await fetch(`${API_BASE}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clearAnthropicAuthToken: true }),
      });
      if ((await res.json()).ok) {
        addToast('Claude OAuth token removed', 'success');
        await loadData();
      }
    } finally {
      setSavingAuth(false);
    }
  };

  const handleSaveTranscribe = async () => {
    setSavingTranscribe(true);
    try {
      const res = await fetch(`${API_BASE}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcribeUrl: transcribeUrl.trim(),
          transcribeModel: transcribeModel.trim(),
        }),
      });
      if ((await res.json()).ok) {
        addToast('Transcription settings saved', 'success');
      } else {
        addToast('Failed to save', 'error');
      }
    } catch {
      addToast('Failed to save', 'error');
    } finally {
      setSavingTranscribe(false);
    }
  };

  if (loading) {
    return (
      <Card variant="glass" className="p-6 mb-8">
        <div className="text-center py-4 text-surface-600">Loading…</div>
      </Card>
    );
  }

  return (
    <Card variant="glass" className="p-6 mb-8">
      <h3 className="text-lg font-semibold text-surface-950 mb-4 flex items-center gap-2">
        <Mic className="w-5 h-5" />
        Chat & Voice
      </h3>

      <div className="space-y-6">
        {/* Claude OAuth subscription token */}
        <div>
          <label className="flex items-center gap-2 text-[13px] font-medium text-surface-800 mb-2">
            <Key className="w-4 h-4" />
            Claude OAuth Token
            <span className="font-normal text-surface-500">
              (use your Claude.ai subscription instead of API billing)
            </span>
          </label>

          {hasAuth && authSource === 'settings' ? (
            <div className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
              <CheckCircle className="w-5 h-5 text-emerald-400" />
              <div className="flex-1">
                <span className="text-[13px] text-emerald-400 font-medium">OAuth token set</span>
                {authHint && (
                  <span className="text-[13px] text-emerald-400/70 ml-2 font-mono">
                    --------{authHint}
                  </span>
                )}
              </div>
              <Button
                variant="ghost-danger"
                size="xs"
                onClick={handleClearAuth}
                disabled={savingAuth}
              >
                Remove
              </Button>
            </div>
          ) : hasAuth && authSource === 'env' ? (
            <div className="flex items-center gap-2 p-3 bg-info-500/10 border border-info-500/20 rounded-xl">
              <CheckCircle className="w-5 h-5 text-info-400" />
              <div className="flex-1">
                <span className="text-[13px] text-info-400 font-medium">
                  Set via ANTHROPIC_AUTH_TOKEN env
                </span>
                {authHint && (
                  <span className="text-[13px] text-info-400/70 ml-2 font-mono">
                    --------{authHint}
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="relative">
                <Input
                  type={showAuth ? 'text' : 'password'}
                  value={authInput}
                  onChange={(e) => setAuthInput(e.target.value)}
                  placeholder="sk-ant-oat01-... or paste from `claude setup-token`"
                  className="pr-10 text-[13px] font-mono"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => setShowAuth(!showAuth)}
                  className="absolute right-2 top-1/2 -translate-y-1/2"
                >
                  {showAuth ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </Button>
              </div>
              <p className="text-[11px] text-surface-600">
                When set, requests are routed through the OAuth bearer endpoint instead of API
                billing. Run <code className="font-mono">claude setup-token</code> on a machine
                where Claude Code is signed in to mint a long-lived token.
              </p>
              {authInput && (
                <Button onClick={handleSaveAuth} size="sm" disabled={savingAuth}>
                  <Save className="w-4 h-4" />
                  {savingAuth ? 'Saving…' : 'Save'}
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Transcription service */}
        <div className="pt-2 border-t border-border/30">
          <label className="block text-[13px] font-medium text-surface-800 mb-2">
            Transcription service URL
          </label>
          <Input
            type="text"
            value={transcribeUrl}
            onChange={(e) => setTranscribeUrl(e.target.value)}
            placeholder="http://nas.local:8000"
            className="text-[13px] font-mono"
          />
          <p className="text-[11px] text-surface-600 mt-1">
            Any OpenAI-compatible <code className="font-mono">/audio/transcriptions</code> server
            works. Suggested:
            <a
              href="https://github.com/Blaizzy/mlx-audio"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-400 hover:underline ml-1"
            >
              parakeet-mlx
            </a>{' '}
            (English-only, fast on Apple Silicon),
            <a
              href="https://github.com/fedirz/faster-whisper-server"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-400 hover:underline ml-1"
            >
              faster-whisper-server
            </a>
            , or
            <a
              href="https://github.com/ggerganov/whisper.cpp"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-400 hover:underline ml-1"
            >
              whisper.cpp
            </a>
            . Just the host root is fine —{' '}
            <code className="font-mono">/v1/audio/transcriptions</code> is appended automatically.
          </p>

          <label className="block text-[13px] font-medium text-surface-800 mb-2 mt-4">Model</label>
          <Input
            type="text"
            value={transcribeModel}
            onChange={(e) => setTranscribeModel(e.target.value)}
            placeholder="parakeet-tdt-0.6b-v2"
            className="text-[13px] font-mono"
          />
          <p className="text-[11px] text-surface-600 mt-1">
            Passed as the <code className="font-mono">model</code> field. For Parakeet:{' '}
            <code className="font-mono">parakeet-tdt-0.6b-v2</code>. For Whisper:{' '}
            <code className="font-mono">whisper-large-v3</code>.
          </p>

          <Button
            onClick={handleSaveTranscribe}
            size="sm"
            disabled={savingTranscribe}
            className="mt-3"
          >
            <Save className="w-4 h-4" />
            {savingTranscribe ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </Card>
  );
}
