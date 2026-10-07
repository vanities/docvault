// Per-person voice profile — reference clips that teach the TTS narrator to
// sound like this person (newsstand narration, voice-clone test playback).
//
// Zero-shot cloning means there is no training step: the newest clip IS the
// voice. The card supports recording in-browser (MediaRecorder — secure
// contexts only, so localhost/HTTPS; Unraid plain-HTTP users upload files
// instead) and plain file upload, then a "Test voice" round trip through the
// configured TTS server (Settings → Voice).

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Loader2, Mic, Square, Trash2, Upload, Volume2, X } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { API_BASE } from '../../constants';
import { useVoiceRecorder } from '../../hooks/useVoiceRecorder';

interface VoiceClip {
  filename: string;
  size: number;
  uploadedAt: string;
}

interface VoiceCardProps {
  personId: string;
  personName: string;
}

/** Recordings auto-stop here — references past ~30 s add nothing to the clone. */
const MAX_RECORDING_MS = 90_000;

// Chatterbox's own defaults — sliders start here so an untouched card sounds
// identical to the server's out-of-the-box voice.
const DEFAULT_EXAGGERATION = 0.5;
const DEFAULT_CFG_WEIGHT = 0.5;

// Read-aloud scripts, ~25 s each at a conversational pace. The clone inherits
// the reference's delivery, so these are written to pull a natural host read:
// varied intonation, a question, some numbers, no tongue-twisters.
const SAMPLE_SCRIPTS = [
  'Good morning, and welcome to the daily edition. Markets are moving, the coffee is ' +
    'strong, and there is plenty to get through today. Before the headlines, one quick ' +
    'note: reading the news out loud is the easy part — the hard part is stopping. ' +
    'Here is what changed overnight, what to watch this afternoon, and why any of it matters.',
  'Here is something I learned the hard way: backups only matter on the day you need ' +
    'them. Fourteen years of records, one quiet Tuesday afternoon, and a hard drive that ' +
    'would not spin up. Since then I keep everything in three places, label it twice, ' +
    'and sleep much better. Some lessons you only need to learn once.',
  'Quick question before we start: what does your voice sound like to everyone else? ' +
    'Probably not what you expect. Speak the way you would across a kitchen table — ' +
    'steady, warm, with a little energy. Throw in some numbers for good measure: ' +
    'nineteen, forty-two, three hundred and seven. If that felt natural, it is exactly ' +
    'the take you want.',
];

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fmtClock(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Map a MediaRecorder blob type to a filename extension the server accepts. */
function extForBlobType(type: string): string {
  if (type.includes('webm')) return 'webm';
  if (type.includes('mp4')) return 'm4a';
  if (type.includes('ogg')) return 'ogg';
  return 'webm';
}

export function VoiceCard({ personId, personName }: VoiceCardProps) {
  const recorder = useVoiceRecorder();
  const [clips, setClips] = useState<VoiceClip[]>([]);
  const [ttsConfigured, setTtsConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null); // user-visible action label
  const [error, setError] = useState<string | null>(null);
  const [testText, setTestText] = useState('');
  const [testAudioUrl, setTestAudioUrl] = useState<string | null>(null);
  const [testMs, setTestMs] = useState<number | null>(null);
  const [exaggeration, setExaggeration] = useState(DEFAULT_EXAGGERATION);
  const [cfgWeight, setCfgWeight] = useState(DEFAULT_CFG_WEIGHT);
  // null = script panel hidden; otherwise the index of the visible script.
  const [scriptIndex, setScriptIndex] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const autoStopFiredRef = useRef(false);

  const voiceApi = `${API_BASE}/health/${encodeURIComponent(personId)}/voice`;

  const reload = useCallback(async () => {
    try {
      const res = await fetch(voiceApi);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = (await res.json()) as { clips: VoiceClip[]; ttsConfigured: boolean };
      setClips(data.clips);
      setTtsConfigured(data.ttsConfigured);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load voice clips');
    } finally {
      setLoading(false);
    }
  }, [voiceApi]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Free the blob URL when a new test replaces it or the card unmounts.
  useEffect(() => {
    return () => {
      if (testAudioUrl) URL.revokeObjectURL(testAudioUrl);
    };
  }, [testAudioUrl]);

  const uploadBlob = useCallback(
    async (blob: Blob, filename: string) => {
      setBusy('Uploading clip…');
      setError(null);
      try {
        const res = await fetch(`${voiceApi}/clips?filename=${encodeURIComponent(filename)}`, {
          method: 'POST',
          body: blob,
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? `${res.status} ${res.statusText}`);
        }
        await reload();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Upload failed');
      } finally {
        setBusy(null);
      }
    },
    [voiceApi, reload]
  );

  const stopAndSave = useCallback(async () => {
    const blob = await recorder.stop();
    if (!blob || blob.size === 0) return;
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    await uploadBlob(blob, `recording-${stamp}.${extForBlobType(blob.type)}`);
  }, [recorder, uploadBlob]);

  // Hard ceiling on recording length — one good 20–30 s take is the goal.
  useEffect(() => {
    if (recorder.status !== 'recording') {
      autoStopFiredRef.current = false;
      return;
    }
    if (recorder.durationMs >= MAX_RECORDING_MS && !autoStopFiredRef.current) {
      autoStopFiredRef.current = true;
      void stopAndSave();
    }
  }, [recorder.status, recorder.durationMs, stopAndSave]);

  const onFilesPicked = async (files: FileList | null) => {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      await uploadBlob(file, file.name);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const deleteClip = async (filename: string) => {
    setBusy(`Deleting ${filename}…`);
    setError(null);
    try {
      const res = await fetch(`${voiceApi}/clips/${encodeURIComponent(filename)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `${res.status} ${res.statusText}`);
      }
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setBusy(null);
    }
  };

  const testVoice = async () => {
    setBusy('Cloning + synthesizing…');
    setError(null);
    setTestMs(null);
    try {
      const res = await fetch(`${voiceApi}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(testText.trim() ? { text: testText.trim() } : {}),
          exaggeration,
          cfgWeight,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `${res.status} ${res.statusText}`);
      }
      const ms = Number(res.headers.get('X-Generation-Ms'));
      const blob = await res.blob();
      setTestAudioUrl(URL.createObjectURL(blob));
      setTestMs(Number.isFinite(ms) && ms > 0 ? ms : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Voice test failed');
    } finally {
      setBusy(null);
    }
  };

  const recording = recorder.status === 'recording' || recorder.status === 'requesting';

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 mb-4">
        <Mic className="w-5 h-5 text-accent-400" />
        <h3 className="font-medium text-surface-950">Voice</h3>
      </div>
      <p className="text-sm text-surface-700 mb-4 leading-relaxed">
        Reference clips teach the narrator to sound like {personName} — for newsstand narration and
        anywhere else DocVault speaks. Two or three clean takes of 15–30 seconds each are plenty:
        quiet room, close to the mic, read like a host. The newest clip is used as the cloning
        reference.
      </p>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0 break-words">{error}</span>
        </div>
      )}

      {/* Capture controls */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {recording ? (
          <>
            <span className="inline-flex items-center gap-2 rounded-xl bg-red-500/10 border border-red-500/20 px-3 py-1.5 text-sm text-red-400">
              <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
              {recorder.status === 'requesting' ? 'Mic…' : fmtClock(recorder.durationMs)}
            </span>
            <Button size="sm" onClick={() => void stopAndSave()}>
              <Square className="h-4 w-4" />
              Stop &amp; save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => recorder.cancel()}>
              <X className="h-4 w-4" />
              Cancel
            </Button>
          </>
        ) : (
          <>
            {recorder.isSupported && (
              <Button size="sm" onClick={() => void recorder.start()} disabled={!!busy}>
                <Mic className="h-4 w-4" />
                Record clip
              </Button>
            )}
            <Button
              size="sm"
              variant={recorder.isSupported ? 'ghost' : 'default'}
              onClick={() => fileInputRef.current?.click()}
              disabled={!!busy}
            >
              <Upload className="h-4 w-4" />
              Upload audio
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*,.m4a,.mp3,.wav,.webm,.ogg,.flac"
              multiple
              className="hidden"
              onChange={(e) => void onFilesPicked(e.target.files)}
            />
          </>
        )}
        {busy && (
          <span className="inline-flex items-center gap-2 text-sm text-surface-600">
            <Loader2 className="h-4 w-4 animate-spin" />
            {busy}
          </span>
        )}
      </div>

      {/* Read-aloud scripts — stays visible while recording, like a teleprompter. */}
      <div className="mb-4">
        {scriptIndex === null ? (
          <button
            type="button"
            className="text-xs text-accent-400 hover:underline"
            onClick={() => setScriptIndex(0)}
          >
            Not sure what to say? Show a script to read
          </button>
        ) : (
          <div className="rounded-xl bg-surface-100 p-3">
            <p className="mb-1 text-xs text-surface-600">
              Read this aloud — about 25 seconds, like you&apos;re talking across the table:
            </p>
            <p className="text-sm leading-relaxed text-surface-900">
              {SAMPLE_SCRIPTS[scriptIndex]}
            </p>
            <div className="mt-2 flex gap-4">
              <button
                type="button"
                className="text-xs text-accent-400 hover:underline"
                onClick={() => setScriptIndex((scriptIndex + 1) % SAMPLE_SCRIPTS.length)}
              >
                Try another
              </button>
              <button
                type="button"
                className="text-xs text-surface-500 hover:underline"
                onClick={() => setScriptIndex(null)}
              >
                Hide
              </button>
            </div>
          </div>
        )}
      </div>

      {!recorder.isSupported && (
        <p className="mb-4 text-xs text-surface-600">
          In-browser recording needs a secure context (HTTPS or localhost) — on plain HTTP, record a
          Voice Memo and upload it instead. HTTPS options are in Settings → Voice.
        </p>
      )}
      {recorder.errorMessage && recorder.status === 'error' && (
        <p className="mb-4 text-xs text-red-400">{recorder.errorMessage}</p>
      )}

      {/* Clip list */}
      {loading ? (
        <div className="flex items-center gap-2 p-2 text-sm text-surface-600">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading clips…
        </div>
      ) : clips.length === 0 ? (
        <p className="mb-4 rounded-xl bg-surface-100 p-3 text-sm text-surface-600">
          No clips yet — record or upload the first one to give {personName} a voice.
        </p>
      ) : (
        <div className="mb-4 space-y-2">
          {clips.map((clip, i) => (
            <div
              key={clip.filename}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-surface-100 px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <span className="block truncate text-sm text-surface-900">{clip.filename}</span>
                <span className="text-xs text-surface-600">
                  {fmtSize(clip.size)} · {new Date(clip.uploadedAt).toLocaleString()}
                  {i === 0 && <span className="ml-2 text-accent-400">cloning reference</span>}
                </span>
              </div>
              <audio
                controls
                preload="none"
                className="h-8 max-w-[220px]"
                src={`${voiceApi}/clips/${encodeURIComponent(clip.filename)}`}
              />
              <Button
                variant="ghost-danger"
                size="icon-xs"
                onClick={() => void deleteClip(clip.filename)}
                disabled={!!busy}
                title="Delete clip"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Test playback */}
      <div className="border-t border-surface-200 pt-4">
        {!ttsConfigured && (
          <p className="mb-2 text-xs text-surface-600">
            Set a text-to-speech server URL in Settings → Voice to enable test playback — clips can
            be collected now either way.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="text"
            value={testText}
            onChange={(e) => setTestText(e.target.value)}
            placeholder="Optional custom test sentence…"
            className="min-w-0 flex-1 text-[13px]"
          />
          <Button
            size="sm"
            onClick={() => void testVoice()}
            disabled={!ttsConfigured || clips.length === 0 || !!busy || recording}
          >
            <Volume2 className="h-4 w-4" />
            Test voice
          </Button>
        </div>

        {/* Clone tuning — per-test knobs, ranges mirror the TTS server schema. */}
        <div className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
          <label className="block text-xs text-surface-600">
            <span className="mb-1 flex items-center justify-between">
              <span>Emotion intensity</span>
              <span className="font-mono text-surface-800">{exaggeration.toFixed(2)}</span>
            </span>
            <input
              type="range"
              min={0.25}
              max={2}
              step={0.05}
              value={exaggeration}
              onChange={(e) => setExaggeration(Number(e.target.value))}
              className="w-full accent-accent-500"
            />
          </label>
          <label className="block text-xs text-surface-600">
            <span className="mb-1 flex items-center justify-between">
              <span>Pace (CFG weight)</span>
              <span className="font-mono text-surface-800">{cfgWeight.toFixed(2)}</span>
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={cfgWeight}
              onChange={(e) => setCfgWeight(Number(e.target.value))}
              className="w-full accent-accent-500"
            />
          </label>
        </div>
        {(exaggeration !== DEFAULT_EXAGGERATION || cfgWeight !== DEFAULT_CFG_WEIGHT) && (
          <button
            type="button"
            className="mt-1 text-xs text-accent-400 hover:underline"
            onClick={() => {
              setExaggeration(DEFAULT_EXAGGERATION);
              setCfgWeight(DEFAULT_CFG_WEIGHT);
            }}
          >
            Reset tuning to defaults
          </button>
        )}
        {testAudioUrl && (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {/* New blob URL per test, so autoPlay re-fires on each render of the element. */}
            <audio key={testAudioUrl} controls autoPlay src={testAudioUrl} className="h-8" />
            {testMs !== null && (
              <span className="text-xs text-surface-600">
                synthesized in {(testMs / 1000).toFixed(1)}s
              </span>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
