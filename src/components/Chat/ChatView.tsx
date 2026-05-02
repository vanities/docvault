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
  Trash2,
  Paperclip,
  X,
  FileText,
  Image as ImageIcon,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { Button } from '@/components/ui/button';
import { useAppContext } from '../../contexts/AppContext';
import { useToast } from '../../hooks/useToast';
import { useVoiceRecorder } from '../../hooks/useVoiceRecorder';
import { API_BASE } from '../../constants';

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

const STORAGE_KEY = 'docvault-chat-history-v1';
const META_STORAGE_KEY = 'docvault-chat-meta-v1';
const MAX_PERSISTED_MESSAGES = 40;

function newId(): string {
  return Math.random().toString(36).slice(2, 11);
}

// chatId + resumeSessionId persistence — separate from message history so
// "Clear chat" can wipe messages while keeping the chat alive, and so
// reloads in the middle of a multi-turn conversation preserve continuity.
interface ChatMeta {
  chatId: string | null;
  resumeSessionId: string | null;
}

function loadChatMeta(): ChatMeta {
  try {
    const raw = localStorage.getItem(META_STORAGE_KEY);
    if (!raw) return { chatId: null, resumeSessionId: null };
    const parsed = JSON.parse(raw) as ChatMeta;
    return {
      chatId: typeof parsed.chatId === 'string' ? parsed.chatId : null,
      resumeSessionId: typeof parsed.resumeSessionId === 'string' ? parsed.resumeSessionId : null,
    };
  } catch {
    return { chatId: null, resumeSessionId: null };
  }
}

function saveChatMeta(meta: ChatMeta): void {
  try {
    localStorage.setItem(META_STORAGE_KEY, JSON.stringify(meta));
  } catch {
    /* quota exceeded */
  }
}

interface UploadedAttachment {
  id: string;
  type: 'image' | 'document';
  mimeType: string;
  name: string;
  sizeBytes: number;
}

function loadHistory(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ChatMessage[];
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

function saveHistory(messages: ChatMessage[]): void {
  try {
    const trimmed = messages.slice(-MAX_PERSISTED_MESSAGES);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    /* quota exceeded — drop the persistence */
  }
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

function Composer({
  onSend,
  pending,
  ensureChatId,
}: {
  onSend: (text: string, attachmentIds: string[]) => void;
  pending: boolean;
  ensureChatId: () => string;
}) {
  const { addToast } = useToast();
  const [text, setText] = useState('');
  const [transcribing, setTranscribing] = useState(false);
  const [transcribeConfigured, setTranscribeConfigured] = useState<boolean | null>(null);
  const [attachments, setAttachments] = useState<UploadedAttachment[]>([]);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const recorder = useVoiceRecorder();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
    onSend(
      trimmed,
      attachments.map((a) => a.id)
    );
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
    setUploadingAttachment(true);
    const chatId = ensureChatId();
    for (const file of files) {
      const form = new FormData();
      form.append('file', file);
      form.append('chatId', chatId);
      try {
        const res = await fetch(`${API_BASE}/chat/attachments`, { method: 'POST', body: form });
        const data = (await res.json()) as Partial<UploadedAttachment> & { error?: string };
        if (!res.ok) {
          addToast(data.error || `Upload failed (${res.status})`, 'error');
          continue;
        }
        if (
          data.id &&
          data.type &&
          data.mimeType &&
          data.name &&
          typeof data.sizeBytes === 'number'
        ) {
          setAttachments((prev) => [
            ...prev,
            {
              id: data.id!,
              type: data.type!,
              mimeType: data.mimeType!,
              name: data.name!,
              sizeBytes: data.sizeBytes!,
            },
          ]);
        }
      } catch (err) {
        addToast(err instanceof Error ? err.message : 'Upload failed', 'error');
      }
    }
    setUploadingAttachment(false);
  };

  const handleRemoveAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const handleMic = useCallback(async () => {
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
  }, [recorder, addToast]);

  const isRecording = recorder.status === 'recording';
  const micDisabled = !recorder.isSupported || transcribing || pending;
  const showMic = transcribeConfigured === true;

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
            {attachments.map((a) => (
              <div
                key={a.id}
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
                  onClick={() => handleRemoveAttachment(a.id)}
                  className="ml-1 text-surface-500 hover:text-surface-950"
                  aria-label={`Remove ${a.name}`}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
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
            disabled={pending || uploadingAttachment}
            aria-label="Attach file"
            className="h-11 w-11 rounded-full"
          >
            {uploadingAttachment ? (
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
              aria-label={isRecording ? 'Stop recording' : 'Start recording'}
              className="h-11 w-11 rounded-full"
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

interface ChatStats {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export function ChatView() {
  const { selectedEntity, setActiveView } = useAppContext();
  const { addToast } = useToast();
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadHistory());
  const [pending, setPending] = useState(false);
  const [credentialsOk, setCredentialsOk] = useState<boolean | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Two IDs for chat session continuity — see server/routes/chat.ts header.
  // chatId is owned by the browser; resumeSessionId is captured from the
  // SDK's session_id once the first turn completes. Both persisted so that
  // a page reload mid-conversation preserves Claude's context.
  const [chatMeta, setChatMeta] = useState<ChatMeta>(() => loadChatMeta());
  useEffect(() => {
    saveChatMeta(chatMeta);
  }, [chatMeta]);

  // Cumulative token + cost counter for the current chat. Resets on Clear.
  // Updated from each turn's `done` event payload.
  const [stats, setStats] = useState<ChatStats>({ inputTokens: 0, outputTokens: 0, costUsd: 0 });

  // Mint a chatId on demand — the very first user send is the trigger, OR
  // the first attachment upload (whichever happens first). Idempotent: if
  // we already have one, return it.
  const ensureChatId = useCallback((): string => {
    if (chatMeta.chatId) return chatMeta.chatId;
    const fresh = crypto.randomUUID();
    setChatMeta((prev) => ({ ...prev, chatId: fresh }));
    return fresh;
  }, [chatMeta.chatId]);

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

  useEffect(() => {
    saveHistory(messages);
  }, [messages]);

  // Auto-scroll to bottom on new messages.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, pending]);

  const handleSend = useCallback(
    async (text: string, attachmentIds: string[]) => {
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
        const res = await fetch(`${API_BASE}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: apiMessages,
            entity: selectedEntity === 'all' ? undefined : selectedEntity,
            chatId: cid,
            ...(chatMeta.resumeSessionId ? { resumeSessionId: chatMeta.resumeSessionId } : {}),
            ...(attachmentIds.length > 0 ? { attachmentIds } : {}),
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
              setChatMeta((prev) => ({ ...prev, resumeSessionId: event.sessionId ?? null }));
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
    [messages, selectedEntity, chatMeta.resumeSessionId, ensureChatId]
  );

  const handleClear = () => {
    if (messages.length === 0 && !chatMeta.chatId) return;
    setMessages([]);
    setChatMeta({ chatId: null, resumeSessionId: null });
    setStats({ inputTokens: 0, outputTokens: 0, costUsd: 0 });
    addToast('Chat cleared', 'success');
  };

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-border bg-surface-50 px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MessageCircle className="w-4 h-4 text-fuchsia-400" />
          <span className="font-semibold text-[14px] text-surface-950">Chat</span>
          {selectedEntity !== 'all' && (
            <span className="text-[11px] text-surface-600">· {selectedEntity}</span>
          )}
        </div>
        {messages.length > 0 && (
          <Button variant="ghost" size="xs" onClick={handleClear}>
            <Trash2 className="w-3.5 h-3.5" />
            Clear
          </Button>
        )}
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

      <Composer onSend={handleSend} pending={pending} ensureChatId={ensureChatId} />
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
