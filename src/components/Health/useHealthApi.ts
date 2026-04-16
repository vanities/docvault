// Thin client wrapper around /api/health routes.

import { useCallback, useMemo } from 'react';
import type { HealthPerson } from '../../hooks/useFileSystemServer';
import { API_BASE } from '../../constants';
import type {
  ActivitySnapshot,
  AppleHealthSummary,
  BodySnapshot,
  ExportInfo,
  HealthSegment,
  HeartSnapshot,
  PersonSnapshots,
  SleepSnapshot,
  WorkoutsSnapshot,
} from './types';

type SnapshotFor<S extends HealthSegment | 'all'> = S extends 'activity'
  ? ActivitySnapshot
  : S extends 'heart'
    ? HeartSnapshot
    : S extends 'sleep'
      ? SleepSnapshot
      : S extends 'workouts'
        ? WorkoutsSnapshot
        : S extends 'body'
          ? BodySnapshot
          : PersonSnapshots;

/**
 * Result envelope for getSnapshot. Carries both the segment data and
 * version metadata so the UI can detect and warn about stale caches.
 */
export interface SnapshotResult<S extends HealthSegment | 'all'> {
  data: SnapshotFor<S>;
  stale: boolean;
  cachedParserVersion: string;
  currentParserVersion: string;
  /** Illness notes — only present when segment='all'. */
  illnessNotes?: Record<string, { note?: string; dismissed?: boolean; updatedAt: string }>;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  // Normalize caller-provided headers to a plain object before merging.
  // `HeadersInit` can be a Headers instance, [string, string][], or
  // Record<string, string> — spread would give wrong results on the array form.
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (init?.headers) {
    new Headers(init.headers).forEach((v, k) => {
      headers[k] = v;
    });
  }
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { error?: string; details?: string };
      if (body.error) msg = body.error + (body.details ? `: ${body.details}` : '');
    } catch {
      // ignore
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

export function useHealthApi() {
  const listPeople = useCallback(async (): Promise<HealthPerson[]> => {
    const res = await request<{ people: HealthPerson[] }>(`${API_BASE}/health/people`);
    return res.people;
  }, []);

  const createPerson = useCallback(async (name: string, color?: string): Promise<HealthPerson> => {
    const res = await request<{ person: HealthPerson }>(`${API_BASE}/health/people`, {
      method: 'POST',
      body: JSON.stringify({ name, color }),
    });
    return res.person;
  }, []);

  const updatePerson = useCallback(
    async (
      id: string,
      updates: { name?: string; color?: string; icon?: string }
    ): Promise<HealthPerson> => {
      const res = await request<{ person: HealthPerson }>(`${API_BASE}/health/people/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
      });
      return res.person;
    },
    []
  );

  const deletePerson = useCallback(
    async (id: string, mode: 'archive' | 'delete'): Promise<void> => {
      await request<{ ok: true }>(`${API_BASE}/health/people/${id}?mode=${mode}`, {
        method: 'DELETE',
      });
    },
    []
  );

  const listExports = useCallback(async (personId: string): Promise<ExportInfo[]> => {
    const res = await request<{ exports: ExportInfo[] }>(`${API_BASE}/health/${personId}/exports`);
    return res.exports;
  }, []);

  const parseExport = useCallback(
    async (personId: string, filename: string): Promise<AppleHealthSummary> => {
      const res = await request<{ ok: true; summary: AppleHealthSummary }>(
        `${API_BASE}/health/${personId}/parse-export`,
        {
          method: 'POST',
          body: JSON.stringify({ filename }),
        }
      );
      return res.summary;
    },
    []
  );

  const getSummary = useCallback(
    async (personId: string, filename: string): Promise<AppleHealthSummary> => {
      const res = await request<{ summary: AppleHealthSummary }>(
        `${API_BASE}/health/${personId}/summary/${encodeURIComponent(filename)}`
      );
      return res.summary;
    },
    []
  );

  /**
   * Upload an Apple Health export.zip to a person's exports directory.
   * Upload + unarchive + parse in a single round-trip. The zip is saved
   * server-side, extracted to `<basename>.xml` next to it (persistent cache,
   * backed up with the data dir), then streamed through the parser. The full
   * summary comes back in the response so the UI can render immediately
   * without a follow-up fetch.
   */
  const uploadAndParseExport = useCallback(
    async (
      personId: string,
      file: File
    ): Promise<{ filename: string; summary: AppleHealthSummary }> => {
      const qs = new URLSearchParams({ filename: file.name });
      const res = await fetch(`${API_BASE}/health/${personId}/upload-export?${qs.toString()}`, {
        method: 'POST',
        body: file,
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as {
          error?: string;
          details?: string;
        };
        const msg = err.error ?? `Upload+parse failed: ${res.status}`;
        throw new Error(err.details ? `${msg}: ${err.details}` : msg);
      }
      const body = (await res.json()) as {
        ok: true;
        filename: string;
        summary: AppleHealthSummary;
      };
      return { filename: body.filename, summary: body.summary };
    },
    []
  );

  /**
   * Fetch a single segment snapshot for this person's latest parsed export.
   * Returns the cached snapshot from .docvault-health.json, or backfills
   * on-demand if the summary exists but snapshots haven't been computed yet.
   * The result also carries a `stale` flag and the current/cached parser
   * versions — the UI uses this to prompt a re-parse when the cache was
   * produced by an older parser.
   */
  const getSnapshot = useCallback(
    async <S extends HealthSegment | 'all'>(
      personId: string,
      segment: S
    ): Promise<SnapshotResult<S>> => {
      const res = await request<{
        segment?: string;
        snapshot?: PersonSnapshots;
        data?: unknown;
        stale: boolean;
        cachedParserVersion: string;
        currentParserVersion: string;
        illnessNotes?: Record<string, { note?: string; dismissed?: boolean; updatedAt: string }>;
      }>(`${API_BASE}/health/${personId}/snapshot/${segment}`);
      const data = (res.snapshot ?? res.data) as SnapshotFor<S>;
      return {
        data,
        stale: res.stale,
        cachedParserVersion: res.cachedParserVersion,
        currentParserVersion: res.currentParserVersion,
        illnessNotes: res.illnessNotes,
      };
    },
    []
  );

  // Memoize the return object so consumers that put `api` in a useEffect
  // dependency array don't spin in an infinite loop. Without this wrapper,
  // every render of the calling component creates a fresh object literal —
  // even though the individual callbacks are stable `useCallback`s, the
  // wrapper's identity changes, which busts dep-array equality checks.
  /** PUT /api/health/:personId/illness-notes/:key — update or delete an illness note. */
  const updateIllnessNote = useCallback(
    async (personId: string, key: string, data: { note?: string; dismissed?: boolean }) => {
      const res = await fetch(`/api/health/${personId}/illness-notes/${key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(await res.text());
    },
    []
  );

  return useMemo(
    () => ({
      listPeople,
      createPerson,
      updatePerson,
      deletePerson,
      listExports,
      parseExport,
      getSummary,
      uploadAndParseExport,
      getSnapshot,
      updateIllnessNote,
    }),
    [
      listPeople,
      createPerson,
      updatePerson,
      deletePerson,
      listExports,
      parseExport,
      getSummary,
      uploadAndParseExport,
      getSnapshot,
      updateIllnessNote,
    ]
  );
}
