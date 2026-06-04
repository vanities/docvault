// Federal Register presidential documents — forward-only executive-action ingest.
//
// Ported from the Check the Vote repo (`lib/ingest/federal-register/*`). Keyless
// public API. Pulls newest-first presidential documents (Executive Orders,
// proclamations, memoranda) — the President's analog to "bills".

import { createLogger } from '../logger.js';
import type { ExecutiveActionRecord, ExecutiveActionType } from './types.js';

const log = createLogger('PoliticsExecActions');

const BASE_URL = 'https://www.federalregister.gov/api/v1';

interface FederalRegisterDocument {
  document_number: string;
  title: string;
  type: string;
  subtype?: string;
  publication_date: string;
  signing_date?: string;
  executive_order_number?: string;
  html_url?: string;
  raw_text_url?: string;
}

interface FederalRegisterDocumentsResponse {
  count: number;
  results?: FederalRegisterDocument[];
}

const SUBTYPE_MAP: Record<string, ExecutiveActionType> = {
  'Executive Order': 'executive_order',
  Proclamation: 'proclamation',
  Memorandum: 'signing_statement',
  Notice: 'signing_statement',
  Determination: 'signing_statement',
};

function inferType(doc: FederalRegisterDocument): ExecutiveActionType {
  if (doc.subtype && SUBTYPE_MAP[doc.subtype]) return SUBTYPE_MAP[doc.subtype];
  if (doc.executive_order_number) return 'executive_order';
  return 'proclamation';
}

export function transformExecutiveAction(doc: FederalRegisterDocument): ExecutiveActionRecord {
  return {
    slug: doc.executive_order_number
      ? `eo-${doc.executive_order_number}`
      : `fr-${doc.document_number}`,
    type: inferType(doc),
    issuedDate: doc.signing_date ?? doc.publication_date,
    title: doc.title,
    url: doc.html_url ?? doc.raw_text_url ?? null,
    federalRegisterNumber: doc.document_number,
  };
}

export interface FetchExecutiveActionsOptions {
  /** Only fetch documents published on/after this date (the prior run's cursor). */
  sinceDate?: string;
  perPage?: number;
  fetchFn?: typeof fetch;
}

/** Forward-only: newest-first presidential documents, optionally filtered to
 *  publication_date >= sinceDate. Returns records + the new high-water mark. */
export async function fetchRecentExecutiveActions(
  opts: FetchExecutiveActionsOptions = {}
): Promise<{ actions: ExecutiveActionRecord[]; newestIssuedDate?: string }> {
  const fetchFn = opts.fetchFn ?? fetch;
  const url = new URL(`${BASE_URL}/documents.json`);
  url.searchParams.set('conditions[type][]', 'PRESDOCU');
  url.searchParams.set('per_page', String(opts.perPage ?? 50));
  url.searchParams.set('order', 'newest');
  if (opts.sinceDate) {
    url.searchParams.set('conditions[publication_date][gte]', opts.sinceDate.slice(0, 10));
  }

  const res = await fetchFn(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`Federal Register fetch failed: HTTP ${res.status}`);
  }
  const data = (await res.json()) as FederalRegisterDocumentsResponse;
  const actions = (data.results ?? []).map(transformExecutiveAction);

  let newestIssuedDate: string | undefined;
  for (const action of actions) {
    if (!newestIssuedDate || action.issuedDate > newestIssuedDate)
      newestIssuedDate = action.issuedDate;
  }

  log.info(`Fetched ${actions.length} presidential documents (since=${opts.sinceDate ?? 'none'})`);
  return { actions, newestIssuedDate };
}
