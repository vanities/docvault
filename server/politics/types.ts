// Politics feed — normalized record shapes for the in-container political-data
// ingest that replaces the external "Check the Vote" Pi bridge.
//
// Ported (forward-only, no historical backfill) from the Check the Vote repo's
// `lib/ingest/**` pipelines into DocVault's flat-JSON world. All results land in
// a single rolling-window cache (`.docvault-politics.json`); there is no
// relational model — politician linking and cross-source joins are out of scope.
//
// Field names are deliberately chosen to match what the existing Politics-tab
// consumers already read (`src/components/Politics/politicsData.ts`,
// `server/research-politics-links.ts`) so the producer can be swapped under them
// with only cosmetic edits.

import type { OptionDetail } from './option-description.js';

export type TradeCategory = 'buy' | 'sell' | 'exchange' | 'gift' | 'other';

export type TradeChamber = 'house' | 'senate' | 'executive' | 'unknown';

/** A single politician stock/asset transaction (House/Senate PTR or OGE 278-T). */
export interface TradeRecord {
  externalId: string;
  source: string; // 'house-ptr' | 'senate-ptr' | 'oge-278t'
  chamber: TradeChamber;
  /** Consumers read `politicianName` first, then `filerName` — populate both. */
  politicianName: string;
  filerName: string;
  owner: string | null;
  assetName: string;
  ticker: string | null;
  assetType: string | null;
  transactionType: string | null; // 'purchase' | 'sale' | 'exchange' | ...
  transactionDescription: string;
  category: TradeCategory;
  tradeDate: string; // YYYY-MM-DD
  filingDate: string | null;
  /** Consumers read both `amountRange` and `amount` — keep them identical. */
  amount: string | null; // "$1,001 - $15,000"
  amountRange: string | null;
  amountMin: number | null;
  amountMax: number | null;
  filingDocId: string | null;
  filingYear: number | null;
  /** Consumers read `sourceUrl`; keep `filingUrl` as an alias. */
  filingUrl: string | null;
  sourceUrl: string | null;
  /** Filer's free-text DESCRIPTION field (House PTR), when present — carries the
   *  option contract, exercise notes, gift context, etc. */
  description?: string | null;
  /** Structured option contract parsed from `description` (call/put, strike,
   *  expiry, contracts) — the copy-trade-grade detail the asset row omits. */
  option?: OptionDetail | null;
}

export type BillStatus =
  | 'introduced'
  | 'committee'
  | 'passed_chamber'
  | 'passed_both'
  | 'signed'
  | 'vetoed';

/** A congressional bill (Congress.gov). Surfaced in the feed's `votes` stream so
 *  the existing vote cards + topic matcher light up without UI changes. */
export interface BillRecord {
  externalId: string; // "hr-3076-119"
  congress: number; // 119
  number: string; // "3076"
  officialId: string; // "HR 3076"
  title: string;
  type: string; // hr, s, hjres, ...
  status: BillStatus;
  introducedDate: string | null;
  latestAction: string | null;
  latestActionDate: string | null;
  /** Official CRS/Congress.gov summary text, stripped of Congress.gov HTML. */
  summary: string | null;
  summarySource: 'congress-crs' | null;
  summaryActionDate: string | null;
  /** Last time Congress.gov summaries were checked, even if no summary existed yet. */
  summaryCheckedAt: string | null;
  summaryUpdatedAt: string | null;
  updateDate: string;
  url: string | null;
}

export type ExecutiveActionType = 'executive_order' | 'proclamation' | 'signing_statement';

/** A presidential document (Federal Register `type=PRESDOCU`) — EOs,
 *  proclamations, memoranda. The President's analog to a "bill". */
export interface ExecutiveActionRecord {
  slug: string; // "eo-14100" | "fr-2026-12345"
  type: ExecutiveActionType;
  title: string;
  issuedDate: string; // YYYY-MM-DD
  url: string | null;
  federalRegisterNumber: string;
}

/** A disclosure filing we discovered but could NOT parse into transactions
 *  (scanned/blank PDF). Surfaced in the "filings needing attention" bucket. */
export interface FilingRecord {
  externalId: string;
  source: string;
  chamber: TradeChamber;
  filerName: string;
  politicianName: string;
  filingDate: string | null;
  status: 'needs_attention';
  warning: string;
  docId: string | null;
  sourceUrl: string | null;
}

/** Forward-only cursors + dedup ledgers. This is the "no backfill" guarantee:
 *  each daily run only walks back as far as these cursors, never all of history. */
export interface PoliticsCursors {
  billsUpdateDate?: string; // max bill updateDate ingested
  execIssuedDate?: string; // max executive-action issuedDate ingested
  houseYear?: number;
  ogeLastDocDate?: string;
  senateLastSeen?: string;
}

export interface PoliticsSeen {
  houseDocIds: string[];
  ogeDocIds: string[];
  senateFilingIds: string[];
}

/** On-disk cache: the emitted feed + the forward-only state, all in one file. */
export interface PoliticsCache {
  generatedAt: string | null;
  bills: BillRecord[]; // newest first, capped
  executiveActions: ExecutiveActionRecord[]; // newest first, capped
  trades: TradeRecord[]; // newest first, capped
  filings: FilingRecord[]; // needs-attention, capped
  cursors: PoliticsCursors;
  seen: PoliticsSeen;
}

/** Per-source outcome, surfaced as "sync events" in the dashboard + logged. */
export interface PoliticsSourceResult {
  source: string;
  ok: boolean;
  added: number;
  error?: string;
}

export interface PoliticsRefreshResult {
  generatedAt: string;
  results: PoliticsSourceResult[];
  errors: string[];
  counts: { bills: number; executiveActions: number; trades: number; filings: number };
}
