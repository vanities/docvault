import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';
import type { Entity, TaxDocument } from '../types';

/** Scope requests and local edits to the entity that started them. */
export function useEntityDocuments(
  entity: Entity,
  scan: (entity: Entity) => Promise<TaxDocument[]>
) {
  const session = useRef<{ entity: Entity; active: boolean; request: number } | null>(null);
  const [state, setState] = useState<{
    entity: Entity;
    documents: TaxDocument[];
    loading: boolean;
    error: string | null;
  }>({ entity, documents: [], loading: true, error: null });
  const reload = useCallback(async () => {
    const current = session.current;
    if (!current?.active || current.entity !== entity) return;
    const request = ++current.request;
    setState((previous) => ({
      entity,
      documents: previous.entity === entity ? previous.documents : [],
      loading: true,
      error: null,
    }));
    try {
      const documents = await scan(entity);
      if (current.active && current.request === request)
        setState({ entity, documents, loading: false, error: null });
    } catch (error) {
      if (current.active && current.request === request)
        setState((previous) => ({
          ...previous,
          loading: false,
          error: error instanceof Error ? error.message : 'Could not load documents',
        }));
    }
  }, [entity, scan]);
  useEffect(() => {
    const current = { entity, active: true, request: 0 };
    session.current = current;
    void reload();
    return () => {
      current.active = false;
    };
  }, [entity, reload]);
  const setDocuments = useCallback(
    (update: SetStateAction<TaxDocument[]>) => {
      if (!session.current?.active || session.current.entity !== entity) return;
      setState((previous) =>
        previous.entity !== entity
          ? previous
          : {
              ...previous,
              documents: typeof update === 'function' ? update(previous.documents) : update,
            }
      );
    },
    [entity]
  );
  return {
    documents: state.entity === entity ? state.documents : [],
    isLoading: state.entity !== entity || state.loading,
    error: state.entity === entity ? state.error : null,
    reload,
    setDocuments,
  };
}
