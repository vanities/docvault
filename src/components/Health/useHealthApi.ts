// Thin client wrapper around /api/health routes.

import { useCallback, useMemo } from 'react';
import type { HealthPerson } from '../../hooks/useFileSystemServer';
import { API_BASE } from '../../constants';
import type {
  ActivitySnapshot,
  AppleHealthSummary,
  BodySnapshot,
  ClinicalSummary,
  ExportInfo,
  HealthSegment,
  HeartSnapshot,
  NutritionEntry,
  PersonSnapshots,
  SicknessLog,
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
  /**
   * Fetch the FHIR clinical summary (labs, panels, vitals, conditions, …)
   * for this person's most recent parsed export. Returns `null` if the
   * person has no clinical records yet (API returns 404 — caller can
   * handle by showing an empty state).
   */
  const getClinical = useCallback(
    async (
      personId: string
    ): Promise<{
      clinical: ClinicalSummary;
      sourceFilename: string;
      stale: boolean;
    } | null> => {
      const res = await fetch(`${API_BASE}/health/${personId}/clinical`);
      if (res.status === 404) return null;
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
      const body = (await res.json()) as {
        clinical: ClinicalSummary;
        sourceFilename: string;
        stale: boolean;
      };
      return body;
    },
    []
  );

  /** Nutrition: list all supplement/food labels for a person. */
  const listNutrition = useCallback(async (personId: string): Promise<NutritionEntry[]> => {
    const res = await request<{ entries: NutritionEntry[] }>(
      `${API_BASE}/health/${personId}/nutrition`
    );
    return res.entries;
  }, []);

  /** Nutrition: upload a label image; parser runs server-side and returns the full entry. */
  const uploadNutritionLabel = useCallback(
    async (
      personId: string,
      file: File,
      status: 'considering' | 'active' | 'past' | 'never' = 'considering'
    ): Promise<NutritionEntry> => {
      const qs = new URLSearchParams({ filename: file.name, status });
      const res = await fetch(`${API_BASE}/health/${personId}/nutrition/upload?${qs.toString()}`, {
        method: 'POST',
        body: file,
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `Upload failed: ${res.status}`);
      }
      const body = (await res.json()) as { entry: NutritionEntry };
      return body.entry;
    },
    []
  );

  /** Nutrition: patch status/dose/notes/research/citations/parsed fields. */
  const updateNutrition = useCallback(
    async (
      personId: string,
      id: string,
      updates: Partial<{
        status: 'considering' | 'active' | 'past' | 'never';
        dose: NutritionEntry['dose'] | null;
        notes: string | null;
        research: string | null;
        citations: NutritionEntry['citations'] | null;
        parsed: NutritionEntry['parsed'] | null;
      }>
    ): Promise<NutritionEntry> => {
      const res = await request<{ entry: NutritionEntry }>(
        `${API_BASE}/health/${personId}/nutrition/${id}`,
        {
          method: 'PATCH',
          body: JSON.stringify(updates),
        }
      );
      return res.entry;
    },
    []
  );

  /** Nutrition: re-run the parser against the stored image. */
  const reparseNutrition = useCallback(
    async (personId: string, id: string): Promise<NutritionEntry> => {
      const res = await request<{ entry: NutritionEntry }>(
        `${API_BASE}/health/${personId}/nutrition/${id}/reparse`,
        { method: 'POST' }
      );
      return res.entry;
    },
    []
  );

  /** Nutrition: delete a label + its image file. */
  const deleteNutrition = useCallback(async (personId: string, id: string): Promise<void> => {
    await request<{ ok: true }>(`${API_BASE}/health/${personId}/nutrition/${id}`, {
      method: 'DELETE',
    });
  }, []);

  /** Nutrition: build the image URL for an entry (no auth — same origin). */
  const nutritionImageUrl = useCallback((personId: string, id: string): string => {
    return `${API_BASE}/health/${personId}/nutrition/${id}/image`;
  }, []);

  /** Sickness: list all manually-logged episodes for a person. */
  const listSickness = useCallback(async (personId: string): Promise<SicknessLog[]> => {
    const res = await request<{ logs: SicknessLog[] }>(`${API_BASE}/health/${personId}/sickness`);
    return res.logs;
  }, []);

  /** Sickness: create a new episode log. */
  const createSickness = useCallback(
    async (
      personId: string,
      input: Omit<SicknessLog, 'id' | 'personId' | 'createdAt' | 'updatedAt'>
    ): Promise<SicknessLog> => {
      const res = await request<{ log: SicknessLog }>(`${API_BASE}/health/${personId}/sickness`, {
        method: 'POST',
        body: JSON.stringify(input),
      });
      return res.log;
    },
    []
  );

  /** Sickness: update fields on an existing episode. */
  const updateSickness = useCallback(
    async (personId: string, id: string, updates: Partial<SicknessLog>): Promise<SicknessLog> => {
      const res = await request<{ log: SicknessLog }>(
        `${API_BASE}/health/${personId}/sickness/${id}`,
        {
          method: 'PATCH',
          body: JSON.stringify(updates),
        }
      );
      return res.log;
    },
    []
  );

  /** Sickness: delete an episode log. */
  const deleteSickness = useCallback(async (personId: string, id: string): Promise<void> => {
    await request<{ ok: true }>(`${API_BASE}/health/${personId}/sickness/${id}`, {
      method: 'DELETE',
    });
  }, []);

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
      getClinical,
      updateIllnessNote,
      listNutrition,
      uploadNutritionLabel,
      updateNutrition,
      reparseNutrition,
      deleteNutrition,
      nutritionImageUrl,
      listSickness,
      createSickness,
      updateSickness,
      deleteSickness,
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
      getClinical,
      updateIllnessNote,
      listNutrition,
      uploadNutritionLabel,
      updateNutrition,
      reparseNutrition,
      deleteNutrition,
      nutritionImageUrl,
      listSickness,
      createSickness,
      updateSickness,
      deleteSickness,
    ]
  );
}
