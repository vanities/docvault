// Voice settings — the transcription service URL/model/key, plus the inline
// HTTPS-setup help for mic access on HTTP origins. Chat backend + provider
// credentials moved to the Models & Chat and AI Credentials cards; this card is
// voice only. (File name kept as ChatSettingsSection so the import is stable.)
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
import { ShieldAlert, ChevronDown, ChevronRight } from 'lucide-react';
import { useToast } from '../../hooks/useToast';
import { API_BASE } from '../../constants';

interface ChatSettingsData {
  transcribeUrl?: string;
  transcribeModel?: string;
  hasTranscribeApiKey?: boolean;
  transcribeApiKeyHint?: string;
  ttsUrl?: string;
  ttsLanguage?: string;
  hasTtsApiKey?: boolean;
  ttsApiKeyHint?: string;
}

// Setup help for users on HTTP origins. Browsers refuse to expose mic
// access (navigator.mediaDevices.getUserMedia) outside secure contexts —
// DocVault on Unraid LAN is HTTP, so we surface the three fixes inline.
// The card hides itself entirely when window.isSecureContext is true so
// it doesn't pollute the settings UI for users who already moved off HTTP.
export function SecureContextHelp() {
  const isInsecure = typeof window !== 'undefined' && !window.isSecureContext;
  const [openSection, setOpenSection] = useState<'tailscale' | 'firefox' | 'chrome' | null>(
    'tailscale'
  );

  if (!isInsecure) return null;

  const host = typeof window !== 'undefined' ? window.location.hostname : 'nas.local';
  const port = typeof window !== 'undefined' ? window.location.port : '3005';

  const toggle = (section: 'tailscale' | 'firefox' | 'chrome') =>
    setOpenSection(openSection === section ? null : section);

  return (
    <div className="mb-6 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
      <div className="flex items-start gap-2 mb-3">
        <ShieldAlert className="w-5 h-5 text-amber-400 mt-0.5 flex-shrink-0" />
        <div className="min-w-0">
          <h4 className="text-[14px] font-semibold text-amber-400">Voice input requires HTTPS</h4>
          <p className="text-[12px] text-surface-700 mt-1 leading-relaxed">
            DocVault is currently served over HTTP at{' '}
            <code className="font-mono text-[11px] bg-surface-100/60 px-1 rounded">
              http://{host}
              {port ? `:${port}` : ''}
            </code>
            . Browsers block microphone access (and other secure-context APIs like clipboard) on
            non-HTTPS origins. Pick one fix below.
          </p>
        </div>
      </div>

      <div className="space-y-1">
        <CollapsibleSetupSection
          title="Tailscale Serve — recommended (works everywhere, including iOS)"
          isOpen={openSection === 'tailscale'}
          onToggle={() => toggle('tailscale')}
        >
          <p className="mb-2">
            One command on your NAS gets you HTTPS via Tailscale's auto-issued Let's Encrypt cert:
          </p>
          <pre className="bg-surface-0 border border-border/40 rounded p-2 my-2 overflow-x-auto text-[11px]">
            {`ssh nas 'tailscale serve --bg --https=443 http://localhost:${port || '3005'}'`}
          </pre>
          <p className="mb-2">After that, DocVault is reachable at:</p>
          <pre className="bg-surface-0 border border-border/40 rounded p-2 my-2 overflow-x-auto text-[11px]">
            {`https://<your-nas-name>.<your-tailnet>.ts.net`}
          </pre>
          <p className="text-[11px] text-surface-600">
            Check the URL with{' '}
            <code className="font-mono bg-surface-100/60 px-1 rounded">tailscale serve status</code>
            . Mic, clipboard, and all secure-context APIs work over the tailnet HTTPS URL.{' '}
            <a
              href="https://tailscale.com/kb/1242/tailscale-serve"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-400 hover:underline"
            >
              Docs
            </a>
            .
          </p>
        </CollapsibleSetupSection>

        <CollapsibleSetupSection
          title="Firefox: dom.securecontext.allowlist"
          isOpen={openSection === 'firefox'}
          onToggle={() => toggle('firefox')}
        >
          <ol className="list-decimal ml-4 space-y-1">
            <li>
              New tab →{' '}
              <code className="font-mono bg-surface-100/60 px-1 rounded">about:config</code> →
              accept the risk
            </li>
            <li>
              Search for{' '}
              <code className="font-mono bg-surface-100/60 px-1 rounded">
                dom.securecontext.allowlist
              </code>
              . If missing, click the <strong>+</strong> button to add as <strong>String</strong>.
            </li>
            <li>
              Set value to (hostnames only — no scheme, no port, comma-separated):
              <pre className="bg-surface-0 border border-border/40 rounded p-2 my-1 overflow-x-auto text-[11px]">
                {host},192.168.1.3
              </pre>
            </li>
            <li>Fully quit Firefox (Cmd-Q on Mac) and reopen.</li>
            <li>
              Visit{' '}
              <code className="font-mono bg-surface-100/60 px-1 rounded">
                http://{host}
                {port ? `:${port}` : ''}
              </code>
              . Mic should now work.
            </li>
          </ol>
          <p className="text-[11px] text-surface-600 mt-2">
            Firefox 95+. Per-profile setting; doesn't sync across devices.
          </p>
        </CollapsibleSetupSection>

        <CollapsibleSetupSection
          title="Chrome / Edge / Brave: unsafely-treat-insecure-origin-as-secure"
          isOpen={openSection === 'chrome'}
          onToggle={() => toggle('chrome')}
        >
          <ol className="list-decimal ml-4 space-y-1">
            <li>
              Visit{' '}
              <code className="font-mono bg-surface-100/60 px-1 rounded">
                chrome://flags/#unsafely-treat-insecure-origin-as-secure
              </code>
            </li>
            <li>Enable the flag</li>
            <li>
              In the textbox, paste (full URLs with scheme + port, comma-separated):
              <pre className="bg-surface-0 border border-border/40 rounded p-2 my-1 overflow-x-auto text-[11px]">
                http://{host}
                {port ? `:${port}` : ''},http://192.168.1.3:3005
              </pre>
            </li>
            <li>Click "Relaunch" at the bottom.</li>
          </ol>
          <p className="text-[11px] text-surface-600 mt-2">
            Per-browser setting. <strong>Doesn't work on iOS</strong> — Safari has no equivalent
            flag, so Tailscale is the only path on iPhone/iPad.
          </p>
        </CollapsibleSetupSection>
      </div>
    </div>
  );
}

function CollapsibleSetupSection({
  title,
  isOpen,
  onToggle,
  children,
}: {
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-amber-500/15 rounded-lg overflow-hidden bg-surface-50/30">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-2 text-left text-[12px] font-medium text-surface-800 hover:bg-surface-100/40"
      >
        {isOpen ? (
          <ChevronDown className="w-3.5 h-3.5 text-surface-500 flex-shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-surface-500 flex-shrink-0" />
        )}
        <span>{title}</span>
      </button>
      {isOpen && (
        <div className="px-3 pb-3 text-[12px] text-surface-700 leading-relaxed">{children}</div>
      )}
    </div>
  );
}

export function ChatSettingsSection() {
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);

  const [transcribeUrl, setTranscribeUrl] = useState('');
  const [transcribeModel, setTranscribeModel] = useState('');
  const [savingTranscribe, setSavingTranscribe] = useState(false);

  const [hasTranscribeApiKey, setHasTranscribeApiKey] = useState(false);
  const [transcribeApiKeyHint, setTranscribeApiKeyHint] = useState<string | undefined>();
  const [transcribeApiKeyInput, setTranscribeApiKeyInput] = useState('');
  const [showTranscribeApiKey, setShowTranscribeApiKey] = useState(false);
  const [savingTranscribeApiKey, setSavingTranscribeApiKey] = useState(false);

  const [ttsUrl, setTtsUrl] = useState('');
  const [ttsLanguage, setTtsLanguage] = useState('');
  const [savingTts, setSavingTts] = useState(false);
  const [hasTtsApiKey, setHasTtsApiKey] = useState(false);
  const [ttsApiKeyHint, setTtsApiKeyHint] = useState<string | undefined>();
  const [ttsApiKeyInput, setTtsApiKeyInput] = useState('');
  const [showTtsApiKey, setShowTtsApiKey] = useState(false);
  const [savingTtsApiKey, setSavingTtsApiKey] = useState(false);

  const loadData = async () => {
    try {
      const res = await fetch(`${API_BASE}/settings`);
      const data: ChatSettingsData = await res.json();
      setTranscribeUrl(data.transcribeUrl ?? '');
      setTranscribeModel(data.transcribeModel ?? '');
      setHasTranscribeApiKey(!!data.hasTranscribeApiKey);
      setTranscribeApiKeyHint(data.transcribeApiKeyHint);
      setTtsUrl(data.ttsUrl ?? '');
      setTtsLanguage(data.ttsLanguage ?? '');
      setHasTtsApiKey(!!data.hasTtsApiKey);
      setTtsApiKeyHint(data.ttsApiKeyHint);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const handleSaveTranscribeApiKey = async () => {
    if (!transcribeApiKeyInput.trim()) return;
    setSavingTranscribeApiKey(true);
    try {
      const res = await fetch(`${API_BASE}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcribeApiKey: transcribeApiKeyInput.trim() }),
      });
      if ((await res.json()).ok) {
        addToast('Transcription API key saved', 'success');
        setTranscribeApiKeyInput('');
        await loadData();
      } else {
        addToast('Failed to save key', 'error');
      }
    } catch {
      addToast('Failed to save key', 'error');
    } finally {
      setSavingTranscribeApiKey(false);
    }
  };

  const handleClearTranscribeApiKey = async () => {
    setSavingTranscribeApiKey(true);
    try {
      const res = await fetch(`${API_BASE}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clearTranscribeApiKey: true }),
      });
      if ((await res.json()).ok) {
        addToast('Transcription API key removed', 'success');
        await loadData();
      }
    } finally {
      setSavingTranscribeApiKey(false);
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

  const handleSaveTts = async () => {
    setSavingTts(true);
    try {
      const res = await fetch(`${API_BASE}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttsUrl: ttsUrl.trim(), ttsLanguage: ttsLanguage.trim() }),
      });
      if ((await res.json()).ok) {
        addToast('Text-to-speech settings saved', 'success');
      } else {
        addToast('Failed to save', 'error');
      }
    } catch {
      addToast('Failed to save', 'error');
    } finally {
      setSavingTts(false);
    }
  };

  const handleSaveTtsApiKey = async () => {
    if (!ttsApiKeyInput.trim()) return;
    setSavingTtsApiKey(true);
    try {
      const res = await fetch(`${API_BASE}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttsApiKey: ttsApiKeyInput.trim() }),
      });
      if ((await res.json()).ok) {
        addToast('Text-to-speech API key saved', 'success');
        setTtsApiKeyInput('');
        await loadData();
      } else {
        addToast('Failed to save key', 'error');
      }
    } catch {
      addToast('Failed to save key', 'error');
    } finally {
      setSavingTtsApiKey(false);
    }
  };

  const handleClearTtsApiKey = async () => {
    setSavingTtsApiKey(true);
    try {
      const res = await fetch(`${API_BASE}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clearTtsApiKey: true }),
      });
      if ((await res.json()).ok) {
        addToast('Text-to-speech API key removed', 'success');
        await loadData();
      }
    } finally {
      setSavingTtsApiKey(false);
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
        Voice
      </h3>

      <SecureContextHelp />

      <div className="space-y-6">
        {/* Transcription service */}
        <div>
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

          {/* Optional API key — for services that require bearer auth
              (e.g. Parakeet PARAKEET_API_KEY, hosted Whisper-as-a-service). */}
          <div className="mt-5">
            <label className="flex items-center gap-2 text-[13px] font-medium text-surface-800 mb-2">
              <Key className="w-4 h-4" />
              API Key
              <span className="font-normal text-surface-500">(optional)</span>
            </label>

            {hasTranscribeApiKey ? (
              <div className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
                <CheckCircle className="w-5 h-5 text-emerald-400" />
                <div className="flex-1">
                  <span className="text-[13px] text-emerald-400 font-medium">API key set</span>
                  {transcribeApiKeyHint && (
                    <span className="text-[13px] text-emerald-400/70 ml-2 font-mono">
                      --------{transcribeApiKeyHint}
                    </span>
                  )}
                </div>
                <Button
                  variant="ghost-danger"
                  size="xs"
                  onClick={handleClearTranscribeApiKey}
                  disabled={savingTranscribeApiKey}
                >
                  Remove
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="relative">
                  <Input
                    type={showTranscribeApiKey ? 'text' : 'password'}
                    value={transcribeApiKeyInput}
                    onChange={(e) => setTranscribeApiKeyInput(e.target.value)}
                    placeholder="Bearer token sent as Authorization header"
                    className="pr-10 text-[13px] font-mono"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => setShowTranscribeApiKey(!showTranscribeApiKey)}
                    className="absolute right-2 top-1/2 -translate-y-1/2"
                  >
                    {showTranscribeApiKey ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </Button>
                </div>
                <p className="text-[11px] text-surface-600">
                  Leave blank for unauthenticated services (e.g. Parakeet on a trusted LAN with no{' '}
                  <code className="font-mono">PARAKEET_API_KEY</code>). When set, sent as{' '}
                  <code className="font-mono">Authorization: Bearer …</code> on every request.
                </p>
                {transcribeApiKeyInput && (
                  <Button
                    onClick={handleSaveTranscribeApiKey}
                    size="sm"
                    disabled={savingTranscribeApiKey}
                  >
                    <Save className="w-4 h-4" />
                    {savingTranscribeApiKey ? 'Saving…' : 'Save'}
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Text-to-speech service — voice cloning + narration */}
        <div>
          <label className="block text-[13px] font-medium text-surface-800 mb-2">
            Text-to-speech service URL
          </label>
          <Input
            type="text"
            value={ttsUrl}
            onChange={(e) => setTtsUrl(e.target.value)}
            placeholder="http://gpu-box.local:4123"
            className="text-[13px] font-mono"
          />
          <p className="text-[11px] text-surface-600 mt-1">
            Any OpenAI-compatible <code className="font-mono">/audio/speech</code> server works.
            Suggested:
            <a
              href="https://github.com/travisvn/chatterbox-tts-api"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-400 hover:underline ml-1"
            >
              chatterbox-tts-api
            </a>{' '}
            (zero-shot voice cloning, Docker, GPU) or
            <a
              href="https://github.com/Blaizzy/mlx-audio"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-400 hover:underline ml-1"
            >
              mlx-audio
            </a>{' '}
            (Apple Silicon). Powers per-person voice profiles (Health → person → Voice) and
            newsstand narration. Just the host root is fine —{' '}
            <code className="font-mono">/v1/audio/speech</code> is appended automatically.
          </p>

          <label className="block text-[13px] font-medium text-surface-800 mb-2 mt-4">
            Voice language
          </label>
          <Input
            type="text"
            value={ttsLanguage}
            onChange={(e) => setTtsLanguage(e.target.value)}
            placeholder="en"
            className="text-[13px] font-mono max-w-[120px]"
          />
          <p className="text-[11px] text-surface-600 mt-1">
            ISO code attached to cloned voices (chatterbox supports 22 languages). Blank ={' '}
            <code className="font-mono">en</code>.
          </p>

          <Button onClick={handleSaveTts} size="sm" disabled={savingTts} className="mt-3">
            <Save className="w-4 h-4" />
            {savingTts ? 'Saving…' : 'Save'}
          </Button>

          {/* Optional API key — for TTS services behind bearer auth. */}
          <div className="mt-5">
            <label className="flex items-center gap-2 text-[13px] font-medium text-surface-800 mb-2">
              <Key className="w-4 h-4" />
              API Key
              <span className="font-normal text-surface-500">(optional)</span>
            </label>

            {hasTtsApiKey ? (
              <div className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
                <CheckCircle className="w-5 h-5 text-emerald-400" />
                <div className="flex-1">
                  <span className="text-[13px] text-emerald-400 font-medium">API key set</span>
                  {ttsApiKeyHint && (
                    <span className="text-[13px] text-emerald-400/70 ml-2 font-mono">
                      --------{ttsApiKeyHint}
                    </span>
                  )}
                </div>
                <Button
                  variant="ghost-danger"
                  size="xs"
                  onClick={handleClearTtsApiKey}
                  disabled={savingTtsApiKey}
                >
                  Remove
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="relative">
                  <Input
                    type={showTtsApiKey ? 'text' : 'password'}
                    value={ttsApiKeyInput}
                    onChange={(e) => setTtsApiKeyInput(e.target.value)}
                    placeholder="Bearer token sent as Authorization header"
                    className="pr-10 text-[13px] font-mono"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => setShowTtsApiKey(!showTtsApiKey)}
                    className="absolute right-2 top-1/2 -translate-y-1/2"
                  >
                    {showTtsApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </Button>
                </div>
                <p className="text-[11px] text-surface-600">
                  Leave blank for unauthenticated services on a trusted LAN. When set, sent as{' '}
                  <code className="font-mono">Authorization: Bearer …</code> on every request.
                </p>
                {ttsApiKeyInput && (
                  <Button onClick={handleSaveTtsApiKey} size="sm" disabled={savingTtsApiKey}>
                    <Save className="w-4 h-4" />
                    {savingTtsApiKey ? 'Saving…' : 'Save'}
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
