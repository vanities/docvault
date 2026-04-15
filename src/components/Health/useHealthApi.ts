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
   * Uses the generic /api/upload endpoint so we reuse existing auth + path
   * resolution. Returns the server-assigned filename (may differ from input
   * if the server deduped with _2 / _3 suffixes).
   */
  const uploadExport = useCallback(
    async (personId: string, file: File): Promise<{ filename: string; path: string }> => {
      const filename = file.name;
      const destPath = `${personId}/exports`;
      const qs = new URLSearchParams({
        entity: 'health',
        path: destPath,
        filename,
      });
      const res = await fetch(`${API_BASE}/upload?${qs.toString()}`, {
        method: 'POST',
        body: file,
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `Upload failed: ${res.status}`);
      }
      const body = (await res.json()) as { ok: true; path: string };
      // The server returns the relative path like "person-abc123/exports/export.zip"
      // Extract just the filename (handles the dedupe suffix case)
      const finalFilename = body.path.split('/').pop() ?? filename;
      return { filename: finalFilename, path: body.path };
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
    uploadExport,
  };
}
