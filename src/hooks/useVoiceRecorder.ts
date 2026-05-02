// Voice recorder hook backed by the browser's MediaRecorder API.
//
// Returns audio as a Blob (typically audio/webm;codecs=opus on Chrome, audio/mp4
// on Safari). The /api/transcribe proxy forwards the multipart blob to the
// configured transcription service (whisper.cpp, faster-whisper-server,
// parakeet-mlx, …) which all accept these container formats.

import { useCallback, useEffect, useRef, useState } from 'react';

export type RecorderStatus = 'idle' | 'requesting' | 'recording' | 'stopping' | 'error';

export interface UseVoiceRecorderResult {
  status: RecorderStatus;
  errorMessage: string | null;
  /** Live recording duration in ms while recording, otherwise 0. */
  durationMs: number;
  start: () => Promise<void>;
  /** Stop and return the recorded blob (or null if nothing was captured). */
  stop: () => Promise<Blob | null>;
  /** Discard any in-progress recording without producing a blob. */
  cancel: () => void;
  isSupported: boolean;
}

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  // Order matters — first hit wins. Opus in WebM is universal on Chromium;
  // Safari only does mp4/aac.
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4;codecs=mp4a.40.2',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return undefined;
}

export function useVoiceRecorder(): UseVoiceRecorderResult {
  const [status, setStatus] = useState<RecorderStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startedAtRef = useRef<number>(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopResolverRef = useRef<((blob: Blob | null) => void) | null>(null);
  const cancelledRef = useRef(false);

  const cleanup = useCallback(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
      streamRef.current = null;
    }
    recorderRef.current = null;
    chunksRef.current = [];
    setDurationMs(0);
  }, []);

  // Stop any active recording on unmount so we don't keep the mic LED on.
  useEffect(() => {
    return () => cleanup();
  }, [cleanup]);

  const isSupported =
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== 'undefined';

  const start = useCallback(async () => {
    if (status === 'recording' || status === 'requesting') return;
    if (!isSupported) {
      setErrorMessage('Voice recording is not supported in this browser.');
      setStatus('error');
      return;
    }
    setErrorMessage(null);
    setStatus('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;
      chunksRef.current = [];
      cancelledRef.current = false;

      recorder.ondataavailable = (e: BlobEvent) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const resolver = stopResolverRef.current;
        stopResolverRef.current = null;
        const wasCancelled = cancelledRef.current;
        const blob = wasCancelled
          ? null
          : new Blob(chunksRef.current, {
              type: chunksRef.current[0]?.type || mimeType || 'audio/webm',
            });
        cleanup();
        setStatus('idle');
        resolver?.(blob);
      };
      recorder.onerror = (e: Event) => {
        setErrorMessage((e as ErrorEvent).message || 'Recorder error');
        setStatus('error');
        const resolver = stopResolverRef.current;
        stopResolverRef.current = null;
        cleanup();
        resolver?.(null);
      };

      // Capture in 250ms chunks so a stop triggers an immediate flush.
      recorder.start(250);
      startedAtRef.current = performance.now();
      setStatus('recording');
      setDurationMs(0);
      tickRef.current = setInterval(() => {
        setDurationMs(Math.max(0, performance.now() - startedAtRef.current));
      }, 100);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Microphone access denied or unavailable.'
      );
      setStatus('error');
      cleanup();
    }
  }, [cleanup, isSupported, status]);

  const stop = useCallback((): Promise<Blob | null> => {
    return new Promise((resolve) => {
      const recorder = recorderRef.current;
      if (!recorder || recorder.state === 'inactive') {
        resolve(null);
        return;
      }
      stopResolverRef.current = resolve;
      cancelledRef.current = false;
      setStatus('stopping');
      recorder.stop();
    });
  }, []);

  const cancel = useCallback(() => {
    const recorder = recorderRef.current;
    cancelledRef.current = true;
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch {
        cleanup();
        setStatus('idle');
      }
    } else {
      cleanup();
      setStatus('idle');
    }
  }, [cleanup]);

  return { status, errorMessage, durationMs, start, stop, cancel, isSupported };
}
