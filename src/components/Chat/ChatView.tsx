// Mobile-first chat with the DocVault assistant.
//
// State model: we keep the full conversation in local state and replay it on
// every send (server is stateless — see server/routes/chat.ts). Each
// assistant turn is rendered as a stack of "blocks" so users can see the
// underlying tool calls Claude ran. The transcript surfaces text + a small
// affordance per tool call, but only the text portions of past assistant
// turns are sent back as conversation history — this keeps the request
// payload small and avoids the model re-explaining tool plumbing.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Mic,
  MicOff,
  Send,
  Loader2,
  AlertCircle,
  MessageCircle,
  ChevronDown,
  ChevronRight,
  Settings as SettingsIcon,
  Paperclip,
  X,
  FileText,
  Image as ImageIcon,
  Plus,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { Button } from '@/components/ui/button';
import { useAppContext, type ChatStats, type PersistedThread } from '../../contexts/AppContext';
import { useToast } from '../../hooks/useToast';
import { useVoiceRecorder } from '../../hooks/useVoiceRecorder';
import { API_BASE } from '../../constants';
import { uuidV4 } from '../../utils/uuid';

interface AssistantTextBlock {
  type: 'text';
  text: string;
}

interface AssistantToolCallBlock {
  type: 'tool_call';
  toolName: string;
  input: unknown;
  result: unknown;
  ok: boolean;
  // Server-emitted tool_use id — used to match streaming tool_result events
  // back to the originating tool_call. Optional so legacy persisted blocks
  // (pre-streaming) still type-check.
  id?: string;
}

type AssistantBlock = AssistantTextBlock | AssistantToolCallBlock;

interface UserMessage {
  id: string;
  role: 'user';
  content: string;
}

interface AssistantMessage {
  id: string;
  role: 'assistant';
  blocks: AssistantBlock[];
  stopReason?: string | null;
  error?: string | null;
}

type ChatMessage = UserMessage | AssistantMessage;

function newId(): string {
  return Math.random().toString(36).slice(2, 11);
}

// Title derivation lives in ChatView (not AppContext) because it needs to
// know about ChatMessage shape — Sidebar / context only see opaque message
// blobs. ChatView calls this on send and passes the result via
// updateActiveChatThread.
function deriveTitleFromMessages(messages: ChatMessage[]): string {
  const firstUser = messages.find((m) => m.role === 'user');
  if (!firstUser) return 'New chat';
  const text = firstUser.content.trim();
  return text.length > 50 ? `${text.slice(0, 50)}…` : text;
}

// Composer-local attachment state. Mirrors t3code's ComposerImageAttachment
// pattern: keep a `previewUrl` (blob: URL via URL.createObjectURL) for cheap
// rendering, plus a `dataUrl` (base64) for sending inline. Both are kept in
// memory only — we don't persist drafts across reloads (yet).
interface ComposerAttachment {
  localId: string;
  type: 'image' | 'document';
  mimeType: string;
  name: string;
  sizeBytes: number;
  dataUrl: string;
  previewUrl?: string;
}

// Build the on-wire message list — { role, content } pairs. Assistant
// messages collapse to the joined text of all text blocks; tool calls are a
// server-side implementation detail and don't need to round-trip.
function toApiMessages(
  history: ChatMessage[],
  pendingUser: string
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const out: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const m of history) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content });
    } else {
      const text = m.blocks
        .filter((b): b is AssistantTextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n\n')
        .trim();
      if (text.length > 0) out.push({ role: 'assistant', content: text });
    }
  }
  out.push({ role: 'user', content: pendingUser });
  return out;
}

// ---------------------------------------------------------------------------
// Tool call card
// ---------------------------------------------------------------------------

const TOOL_LABELS: Record<string, string> = {
  list_entities: 'Listed entities',
  list_files: 'Listed files',
  read_file: 'Read file',
  search_files: 'Searched',
  get_tax_summary: 'Computed tax summary',
  set_metadata: 'Updated metadata',
  add_reminder: 'Created reminder',
};

function ToolCallCard({ block }: { block: AssistantToolCallBlock }) {
  const [open, setOpen] = useState(false);
  const label = TOOL_LABELS[block.toolName] ?? block.toolName;
  const summary =
    block.toolName === 'list_files' && typeof block.input === 'object' && block.input
      ? `${(block.input as { entity?: string }).entity ?? '?'} ${(block.input as { year?: number }).year ?? ''}`.trim()
      : block.toolName === 'search_files' && typeof block.input === 'object' && block.input
        ? `"${(block.input as { query?: string }).query ?? ''}"`
        : '';

  return (
    <div className="my-2 rounded-lg border border-border/40 bg-surface-100/40 text-[12px]">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-surface-200/40"
      >
        {open ? (
          <ChevronDown className="w-3.5 h-3.5 text-surface-500" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-surface-500" />
        )}
        <span className={block.ok ? 'text-surface-700' : 'text-danger-400'}>
          {block.ok ? label : `${label} (failed)`}
        </span>
        {summary && <span className="text-surface-500 truncate">{summary}</span>}
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2">
          <div>
            <div className="text-[10px] text-surface-500 uppercase tracking-wider mb-1">Input</div>
            <pre className="text-[11px] bg-surface-0 border border-border/40 rounded p-2 overflow-x-auto">
              {JSON.stringify(block.input, null, 2)}
            </pre>
          </div>
          <div>
            <div className="text-[10px] text-surface-500 uppercase tracking-wider mb-1">Result</div>
            <pre className="text-[11px] bg-surface-0 border border-border/40 rounded p-2 overflow-x-auto max-h-64 overflow-y-auto">
              {JSON.stringify(block.result, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Message bubbles
// ---------------------------------------------------------------------------

function UserBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] md:max-w-[75%] px-4 py-2.5 rounded-2xl rounded-br-md bg-accent-500/15 text-surface-950 border border-accent-500/20">
        <div className="whitespace-pre-wrap text-[14px] leading-relaxed">{content}</div>
      </div>
    </div>
  );
}

function AssistantBubble({ message }: { message: AssistantMessage }) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[92%] md:max-w-[80%] space-y-1">
        {message.blocks.map((block, i) =>
          block.type === 'text' ? (
            <div
              key={i}
              className="px-4 py-2.5 rounded-2xl rounded-bl-md bg-surface-100/80 border border-border/50 text-[14px] leading-relaxed"
            >
              <ReactMarkdown
                components={{
                  table: (props) => (
                    <table className="my-2 text-[13px] border-collapse w-full" {...props} />
                  ),
                  th: (props) => (
                    <th
                      className="text-left border-b border-border/50 px-2 py-1 font-semibold"
                      {...props}
                    />
                  ),
                  td: (props) => <td className="border-b border-border/30 px-2 py-1" {...props} />,
                  code: ({ className, children, ...props }) => {
                    const isBlock = /language-/.test(className ?? '');
                    return isBlock ? (
                      <code
                        className={`block bg-surface-0 border border-border/40 rounded p-2 my-2 text-[12px] overflow-x-auto ${className ?? ''}`}
                        {...props}
                      >
                        {children}
                      </code>
                    ) : (
                      <code
                        className="bg-surface-0 border border-border/40 rounded px-1 py-0.5 text-[12px]"
                        {...props}
                      >
                        {children}
                      </code>
                    );
                  },
                  a: (props) => (
                    <a
                      className="text-accent-400 underline"
                      target="_blank"
                      rel="noopener noreferrer"
                      {...props}
                    />
                  ),
                  ul: (props) => <ul className="list-disc ml-5 my-1" {...props} />,
                  ol: (props) => <ol className="list-decimal ml-5 my-1" {...props} />,
                  p: (props) => <p className="my-1 whitespace-pre-wrap" {...props} />,
                }}
              >
                {block.text}
              </ReactMarkdown>
            </div>
          ) : (
            <ToolCallCard key={i} block={block} />
          )
        )}
        {message.error && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-danger-500/10 border border-danger-500/20 text-[13px] text-danger-400">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>{message.error}</span>
          </div>
        )}
        {message.stopReason === 'max_turns' && (
          <div className="px-3 py-1.5 text-[11px] text-surface-500">
            (Stopped after the tool-use cap. Ask a follow-up to continue.)
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Composer
// ---------------------------------------------------------------------------

function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const SUPPORTED_IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const SUPPORTED_DOC_MIMES = new Set(['application/pdf']);
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') resolve(result);
      else reject(new Error('Unexpected FileReader result'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
    reader.readAsDataURL(file);
  });
}

function Composer({
  onSend,
  pending,
}: {
  onSend: (text: string, attachments: ComposerAttachment[]) => void;
  pending: boolean;
}) {
  const { addToast } = useToast();
  const { setActiveView } = useAppContext();
  const [text, setText] = useState('');
  const [transcribing, setTranscribing] = useState(false);
  const [transcribeConfigured, setTranscribeConfigured] = useState<boolean | null>(null);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [processingFiles, setProcessingFiles] = useState(false);
  const recorder = useVoiceRecorder();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Revoke any blob: URLs we created when this Composer unmounts so the
  // browser can free the underlying File objects. Without this, navigating
  // away mid-compose leaks the bytes until the GC catches the unreferenced
  // ObjectURL — usually fine but explicit is safer with large images.
  useEffect(() => {
    return () => {
      for (const a of attachments) {
        if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
      }
    };
    // Intentionally only run on unmount (`attachments` would re-trigger and
    // double-revoke). Captured `attachments` is the latest closure value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Probe /api/transcribe once on mount to learn whether voice input is
  // available. The endpoint reads getTranscribeConfig() — same source the
  // POST proxy uses — so this stays consistent with what the upload would do.
  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/transcribe`)
      .then((r) => r.json())
      .then((data: { configured?: boolean }) => {
        if (!cancelled) setTranscribeConfigured(!!data.configured);
      })
      .catch(() => {
        if (!cancelled) setTranscribeConfigured(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-grow textarea up to ~6 lines on mobile.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  const handleSend = () => {
    const trimmed = text.trim();
    // Allow sending with attachments only (no text needed) — the model
    // will infer "describe this" / "what does this say" from context.
    if ((!trimmed && attachments.length === 0) || pending) return;
    // Hand the attachments to ChatView before clearing our state — the
    // parent will pull dataUrls into the chat-send body. We revoke the
    // blob: URLs here since the parent doesn't render those (it'll fetch
    // server-stored copies later if it needs to display them again).
    onSend(trimmed, attachments);
    for (const a of attachments) {
      if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
    }
    setText('');
    setAttachments([]);
  };

  const handleAttachClick = () => {
    fileInputRef.current?.click();
  };

  const handleFilesSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    // Reset the input value immediately so picking the same file twice in a
    // row still fires onChange.
    event.target.value = '';
    if (files.length === 0) return;
    setProcessingFiles(true);
    for (const file of files) {
      const mimeType = file.type || 'application/octet-stream';
      const isImage = SUPPORTED_IMAGE_MIMES.has(mimeType);
      const isDoc = SUPPORTED_DOC_MIMES.has(mimeType);
      if (!isImage && !isDoc) {
        addToast(`Unsupported file type: ${mimeType || file.name}`, 'error');
        continue;
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        addToast(`"${file.name}" exceeds 10MB`, 'error');
        continue;
      }
      try {
        const dataUrl = await readFileAsDataUrl(file);
        const previewUrl = isImage ? URL.createObjectURL(file) : undefined;
        const attachment: ComposerAttachment = {
          localId: uuidV4(),
          type: isImage ? 'image' : 'document',
          mimeType,
          name: file.name || (isImage ? 'image' : 'document'),
          sizeBytes: file.size,
          dataUrl,
          ...(previewUrl ? { previewUrl } : {}),
        };
        setAttachments((prev) => [...prev, attachment]);
      } catch (err) {
        addToast(err instanceof Error ? err.message : `Failed to read ${file.name}`, 'error');
      }
    }
    setProcessingFiles(false);
  };

  const handleRemoveAttachment = (localId: string) => {
    setAttachments((prev) => {
      const removed = prev.find((a) => a.localId === localId);
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
      return prev.filter((a) => a.localId !== localId);
    });
  };

  const handleMic = useCallback(async () => {
    // If the browser blocks getUserMedia (typically because we're on an
    // HTTP origin, which strips navigator.mediaDevices entirely), don't
    // try — direct the user to Settings where SecureContextHelp explains
    // the three fixes (Tailscale / Firefox flag / Chrome flag).
    if (!recorder.isSupported) {
      addToast('Voice input requires HTTPS — see Settings → Chat & Voice', 'info');
      setActiveView('settings');
      return;
    }
    if (recorder.status === 'recording') {
      const blob = await recorder.stop();
      if (!blob || blob.size === 0) return;
      setTranscribing(true);
      try {
        const form = new FormData();
        const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
        form.append('file', blob, `recording.${ext}`);
        const res = await fetch(`${API_BASE}/transcribe`, { method: 'POST', body: form });
        const data = (await res.json()) as { text?: string; error?: string };
        if (!res.ok) {
          addToast(data.error || 'Transcription failed', 'error');
          return;
        }
        const transcript = (data.text ?? '').trim();
        if (!transcript) {
          addToast('No speech detected', 'info');
          return;
        }
        setText((prev) => (prev ? `${prev} ${transcript}` : transcript));
      } catch (err) {
        addToast(err instanceof Error ? err.message : 'Transcription failed', 'error');
      } finally {
        setTranscribing(false);
      }
    } else {
      await recorder.start();
      if (recorder.errorMessage) {
        addToast(recorder.errorMessage, 'error');
      }
    }
  }, [recorder, addToast, setActiveView]);

  const isRecording = recorder.status === 'recording';
  // Note: !recorder.isSupported deliberately does NOT disable the button
  // anymore — handleMic intercepts unsupported clicks and routes them to
  // the Settings help card. Disable only for in-flight states.
  const micDisabled = transcribing || pending;
  const showMic = transcribeConfigured === true;
  const micUnavailable = !recorder.isSupported;

  return (
    <div className="border-t border-border bg-surface-50/95 backdrop-blur supports-[backdrop-filter]:bg-surface-50/80 pb-[env(safe-area-inset-bottom)]">
      <div className="px-3 pt-2 pb-3 max-w-3xl mx-auto">
        {isRecording && (
          <div className="mb-2 flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-danger-500/10 border border-danger-500/20">
            <div className="flex items-center gap-2 text-[13px] text-danger-400">
              <span className="w-2 h-2 rounded-full bg-danger-400 animate-pulse" />
              <span className="font-medium">Recording</span>
              <span className="font-mono text-surface-700">
                {formatDuration(recorder.durationMs)}
              </span>
            </div>
            <Button variant="ghost" size="xs" onClick={recorder.cancel}>
              Cancel
            </Button>
          </div>
        )}
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {attachments.map((a) =>
              a.type === 'image' && a.previewUrl ? (
                <div
                  key={a.localId}
                  className="relative group rounded-lg overflow-hidden border border-border/50 bg-surface-100"
                  title={`${a.name} · ${(a.sizeBytes / 1024).toFixed(1)} KB`}
                >
                  <img src={a.previewUrl} alt={a.name} className="block h-16 w-16 object-cover" />
                  <button
                    type="button"
                    onClick={() => handleRemoveAttachment(a.localId)}
                    className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-surface-950/70 text-surface-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    aria-label={`Remove ${a.name}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                <div
                  key={a.localId}
                  className="group flex items-center gap-2 px-2 py-1.5 rounded-lg bg-surface-100/80 border border-border/50 text-[12px] text-surface-800"
                  title={`${a.name} · ${(a.sizeBytes / 1024).toFixed(1)} KB`}
                >
                  {a.type === 'image' ? (
                    <ImageIcon className="w-3.5 h-3.5 text-accent-400" />
                  ) : (
                    <FileText className="w-3.5 h-3.5 text-fuchsia-400" />
                  )}
                  <span className="truncate max-w-[160px]">{a.name}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveAttachment(a.localId)}
                    className="ml-1 text-surface-500 hover:text-surface-950"
                    aria-label={`Remove ${a.name}`}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )
            )}
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/png,image/jpeg,image/gif,image/webp,application/pdf"
          onChange={handleFilesSelected}
          className="hidden"
        />
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
                // Send on Enter on desktop only — mobile keyboards put a
                // newline by default and "send" via the visible button.
                if (window.matchMedia('(min-width: 768px)').matches) {
                  e.preventDefault();
                  handleSend();
                }
              }
            }}
            placeholder={
              isRecording
                ? 'Listening… tap mic again to stop'
                : transcribing
                  ? 'Transcribing…'
                  : 'Ask about your documents…'
            }
            rows={1}
            disabled={pending || transcribing}
            className="flex-1 resize-none rounded-2xl border border-border/60 bg-surface-0 px-4 py-3 text-[15px] leading-snug text-surface-950 placeholder:text-surface-500 focus:outline-none focus:border-accent-500/50 disabled:opacity-60"
          />
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={handleAttachClick}
            disabled={pending || processingFiles}
            aria-label="Attach file"
            className="h-11 w-11 rounded-full"
          >
            {processingFiles ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Paperclip className="w-5 h-5" />
            )}
          </Button>
          {showMic && (
            <Button
              type="button"
              size="icon"
              variant={isRecording ? 'destructive' : 'ghost'}
              onClick={handleMic}
              disabled={micDisabled}
              aria-label={
                micUnavailable
                  ? 'Voice input requires HTTPS — tap for setup help'
                  : isRecording
                    ? 'Stop recording'
                    : 'Start recording'
              }
              title={
                micUnavailable
                  ? 'Voice input requires HTTPS — tap for setup help'
                  : isRecording
                    ? 'Stop recording'
                    : 'Start recording'
              }
              className={`h-11 w-11 rounded-full ${micUnavailable ? 'opacity-50' : ''}`}
            >
              {transcribing ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : isRecording ? (
                <MicOff className="w-5 h-5" />
              ) : (
                <Mic className="w-5 h-5" />
              )}
            </Button>
          )}
          <Button
            type="button"
            size="icon"
            onClick={handleSend}
            disabled={(!text.trim() && attachments.length === 0) || pending}
            aria-label="Send"
            className="h-11 w-11 rounded-full"
          >
            {pending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({
  configured,
  onOpenSettings,
}: {
  configured: boolean;
  onOpenSettings: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center px-6 py-12">
      <div className="w-14 h-14 rounded-2xl bg-fuchsia-500/10 flex items-center justify-center mb-4">
        <MessageCircle className="w-7 h-7 text-fuchsia-400" />
      </div>
      <h2 className="text-[18px] font-semibold text-surface-950 mb-1">DocVault Chat</h2>
      <p className="text-[14px] text-surface-700 max-w-md mb-6 leading-relaxed">
        Ask questions about your tax documents, search vendors, or set reminders. Use the microphone
        for voice input — works great on phones.
      </p>
      {!configured && (
        <Button variant="outline" size="sm" onClick={onOpenSettings}>
          <SettingsIcon className="w-4 h-4" />
          Configure Claude in Settings
        </Button>
      )}
      {configured && (
        <ul className="text-[13px] text-surface-600 space-y-1 max-w-sm">
          <li>· "What did I make from W-2s in 2024?"</li>
          <li>· "Find every receipt from Home Depot"</li>
          <li>· "Remind me to file Q1 estimated taxes April 15"</li>
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function ChatView() {
  const { selectedEntity, setActiveView, chatThreads, updateActiveChatThread, newChatThread } =
    useAppContext();
  const [pending, setPending] = useState(false);
  const [credentialsOk, setCredentialsOk] = useState<boolean | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // The active thread is the single source of truth for messages, stats,
  // and resumeSessionId. Sidebar's ThreadList drives switching/deleting via
  // the same context actions.
  const activeThread: PersistedThread | null = chatThreads.activeThreadId
    ? (chatThreads.threads[chatThreads.activeThreadId] ?? null)
    : null;

  // Cast the loosely-typed messages array (context stores `unknown[]` since
  // Sidebar doesn't need to know our discriminated-union shape).
  const messages = (activeThread?.messages ?? []) as ChatMessage[];
  const stats = activeThread?.stats ?? { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  const resumeSessionId = activeThread?.resumeSessionId ?? null;

  // Adapter setters that ChatView's render/handlers use. Each one funnels
  // into updateActiveChatThread so localStorage stays in sync via the
  // context's persist effect.
  const setMessages = useCallback(
    (updater: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
      updateActiveChatThread((t) => {
        const prevMessages = t.messages as ChatMessage[];
        const next = typeof updater === 'function' ? updater(prevMessages) : updater;
        // Auto-derive title from the first user message so the picker shows
        // something useful instead of "New chat" forever.
        const title =
          t.title === 'New chat' && next.length > 0 ? deriveTitleFromMessages(next) : t.title;
        return { messages: next, title };
      });
    },
    [updateActiveChatThread]
  );

  const setStats = useCallback(
    (updater: ChatStats | ((prev: ChatStats) => ChatStats)) => {
      updateActiveChatThread((t) => ({
        stats: typeof updater === 'function' ? updater(t.stats) : updater,
      }));
    },
    [updateActiveChatThread]
  );

  const setResumeSessionId = useCallback(
    (sessionId: string | null) => {
      updateActiveChatThread(() => ({ resumeSessionId: sessionId }));
    },
    [updateActiveChatThread]
  );

  // ensureChatId: called when the user starts to send/attach without an
  // active thread (cold-start or after deleting all threads). Mints a
  // thread on demand so chatId is always defined for the API call.
  // newChatThread returns the new id synchronously even though the state
  // update is async — we use it for the in-flight request and React
  // re-renders with the same id once the setChatThreads update lands.
  const ensureChatId = useCallback((): string => {
    if (activeThread) return activeThread.id;
    return newChatThread();
  }, [activeThread, newChatThread]);

  // Detect whether the user has Claude credentials configured at all so we can
  // surface a helpful empty-state CTA instead of letting the first send fail.
  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/settings`)
      .then((r) => r.json())
      .then((data: { hasAnthropicKey?: boolean; hasAnthropicAuthToken?: boolean }) => {
        if (cancelled) return;
        setCredentialsOk(!!(data.hasAnthropicKey || data.hasAnthropicAuthToken));
      })
      .catch(() => setCredentialsOk(null));
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-scroll to bottom on new messages.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, pending]);

  const handleSend = useCallback(
    async (text: string, atts: ComposerAttachment[]) => {
      const userMsg: UserMessage = { id: newId(), role: 'user', content: text };
      const assistantId = newId();
      const assistantMsg: AssistantMessage = {
        id: assistantId,
        role: 'assistant',
        blocks: [],
      };
      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setPending(true);

      const updateAssistant = (updater: (msg: AssistantMessage) => AssistantMessage): void => {
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? updater(m as AssistantMessage) : m))
        );
      };

      try {
        const apiMessages = toApiMessages(messages, text);
        const cid = ensureChatId();
        // Pull the wire-format attachments out of the composer state. The
        // server parses each dataUrl, validates, persists to disk, and
        // builds the matching image/document content block.
        const wireAttachments = atts.map((a) => ({
          name: a.name,
          mimeType: a.mimeType,
          dataUrl: a.dataUrl,
        }));
        const res = await fetch(`${API_BASE}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: apiMessages,
            entity: selectedEntity === 'all' ? undefined : selectedEntity,
            chatId: cid,
            ...(resumeSessionId ? { resumeSessionId } : {}),
            ...(wireAttachments.length > 0 ? { attachments: wireAttachments } : {}),
          }),
        });

        if (!res.ok || !res.body) {
          const fallback = await res.text().catch(() => '');
          updateAssistant((m) => ({
            ...m,
            error: fallback || `Request failed (${res.status})`,
          }));
          return;
        }

        // Stream consumer: read the body as SSE-formatted chunks
        // (`data: <json>\n\n`), buffer across chunk boundaries, and route
        // each parsed event into the assistant message state.
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let separatorIdx: number;
          while ((separatorIdx = buffer.indexOf('\n\n')) !== -1) {
            const eventChunk = buffer.slice(0, separatorIdx);
            buffer = buffer.slice(separatorIdx + 2);

            const dataPayload = eventChunk
              .split('\n')
              .filter((line) => line.startsWith('data:'))
              .map((line) => line.slice(5).trimStart())
              .join('\n');
            if (dataPayload.length === 0) continue;

            let event: {
              type: string;
              text?: string;
              id?: string;
              toolName?: string;
              input?: unknown;
              toolUseId?: string;
              result?: unknown;
              isError?: boolean;
              stopReason?: string | null;
              message?: string;
              sessionId?: string;
              usage?: { inputTokens?: number; outputTokens?: number };
              cost?: number;
            };
            try {
              event = JSON.parse(dataPayload);
            } catch {
              continue;
            }

            if (event.type === 'text' && typeof event.text === 'string') {
              const textChunk = event.text;
              updateAssistant((m) => {
                const blocks = [...m.blocks];
                const lastIdx = blocks.length - 1;
                const lastBlock = blocks[lastIdx];
                if (lastBlock && lastBlock.type === 'text') {
                  blocks[lastIdx] = { type: 'text', text: lastBlock.text + textChunk };
                } else {
                  blocks.push({ type: 'text', text: textChunk });
                }
                return { ...m, blocks };
              });
            } else if (event.type === 'tool_call') {
              const toolCall: AssistantToolCallBlock = {
                type: 'tool_call',
                toolName: event.toolName ?? 'unknown',
                input: event.input,
                result: null,
                ok: true,
                id: event.id,
              };
              updateAssistant((m) => ({ ...m, blocks: [...m.blocks, toolCall] }));
            } else if (event.type === 'tool_result') {
              updateAssistant((m) => ({
                ...m,
                blocks: m.blocks.map((b) =>
                  b.type === 'tool_call' && b.id === event.toolUseId
                    ? { ...b, result: event.result, ok: !event.isError }
                    : b
                ),
              }));
            } else if (event.type === 'session' && typeof event.sessionId === 'string') {
              // Persist the SDK-assigned session ID so the next turn can
              // pass it as resume:. This is what gives us multi-turn
              // continuity across requests.
              setResumeSessionId(event.sessionId ?? null);
            } else if (event.type === 'done') {
              updateAssistant((m) => ({ ...m, stopReason: event.stopReason ?? null }));
              if (event.usage) {
                const inDelta = event.usage.inputTokens ?? 0;
                const outDelta = event.usage.outputTokens ?? 0;
                const costDelta = event.cost ?? 0;
                setStats((prev) => ({
                  inputTokens: prev.inputTokens + inDelta,
                  outputTokens: prev.outputTokens + outDelta,
                  costUsd: prev.costUsd + costDelta,
                }));
              }
            } else if (event.type === 'error') {
              updateAssistant((m) => ({
                ...m,
                error: event.message ?? 'Stream error',
              }));
            }
          }
        }
      } catch (err) {
        updateAssistant((m) => ({
          ...m,
          error: err instanceof Error ? err.message : 'Request failed',
        }));
      } finally {
        setPending(false);
      }
    },
    [
      messages,
      selectedEntity,
      resumeSessionId,
      ensureChatId,
      setMessages,
      setStats,
      setResumeSessionId,
    ]
  );

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-border bg-surface-50 px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <MessageCircle className="w-4 h-4 text-fuchsia-400 flex-shrink-0" />
          <span className="font-semibold text-[14px] text-surface-950 truncate">
            {activeThread?.title ?? 'Chat'}
          </span>
          {selectedEntity !== 'all' && (
            <span className="text-[11px] text-surface-600 flex-shrink-0">· {selectedEntity}</span>
          )}
        </div>
        <Button variant="ghost" size="xs" onClick={() => newChatThread()}>
          <Plus className="w-3.5 h-3.5" />
          New
        </Button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-3 md:px-4 py-4 space-y-3">
          {messages.length === 0 ? (
            <EmptyState
              configured={credentialsOk !== false}
              onOpenSettings={() => setActiveView('settings')}
            />
          ) : (
            messages.map((m) =>
              m.role === 'user' ? (
                <UserBubble key={m.id} content={m.content} />
              ) : (
                <AssistantBubble key={m.id} message={m} />
              )
            )
          )}
          {pending && (
            <div className="flex justify-start">
              <div className="px-4 py-2.5 rounded-2xl rounded-bl-md bg-surface-100/80 border border-border/50 flex items-center gap-2 text-[13px] text-surface-600">
                <Loader2 className="w-4 h-4 animate-spin" />
                Thinking…
              </div>
            </div>
          )}
        </div>
      </div>

      <Composer onSend={handleSend} pending={pending} />
      {(stats.inputTokens > 0 || stats.outputTokens > 0) && (
        <div className="px-3 pb-1 pt-0.5 text-center text-[10px] text-surface-500 font-mono tracking-tight">
          {formatTokens(stats.inputTokens)} in · {formatTokens(stats.outputTokens)} out
          {stats.costUsd > 0 && ` · $${stats.costUsd.toFixed(4)}`}
        </div>
      )}
    </div>
  );
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
