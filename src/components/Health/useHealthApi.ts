// Thin client wrapper around /api/health routes.

import { useCallback } from 'react';
import type { HealthPerson } from '../../hooks/useFileSystemServer';
import { API_BASE } from '../../constants';
import type { AppleHealthSummary, ExportInfo } from './types';

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

  return {
    listPeople,
    createPerson,
    updatePerson,
    deletePerson,
    listExports,
    parseExport,
    getSummary,
    uploadAndParseExport,
  };
}
