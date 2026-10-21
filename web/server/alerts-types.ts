// Pure shared types; the runtime image ships server/ and does not ship src/.

export type AlertSeverity = 'critical' | 'warning';

/** One check as a source reports it. `value` and `threshold` are display strings. */
export interface AlertCheckInput {
  id: string;
  label: string;
  scope: string;
  severity: AlertSeverity;
  active: boolean;
  value: string;
  threshold: string;
}

export interface AlertCheck extends AlertCheckInput {
  /** When the check last went from OK to tripped; null while OK. */
  since: string | null;
  /** Last successful email that covered this check while tripped; reminders count from here. */
  lastAlertAt: string | null;
}

export interface AlertSeriesPoint {
  t: string;
  values: Record<string, number | null>;
}

export interface AlertAdvice {
  critical?: string;
  warning?: string;
}

/** Source-specific payload handed to the source's dashboard file; opaque to the server. */
export interface AlertDetail {
  kind: string;
  data: unknown;
}

/**
 * One number the owner can adjust on the Alerts page (a trip line, a target, a reference rate),
 * declared by the job in every report. The job gets the owner's values back on its next run in
 * DOCVAULT_ALERT_SETTINGS and uses `default` for anything unset.
 */
export interface AlertSettingSpec {
  key: string;
  label: string;
  default: number;
  /** "%" and "$" attach to the number; anything else follows it ("hours", "pts"). */
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  help?: string;
}

/** DOCVAULT_ALERT_SETTINGS: source id → the owner's values, for each source the job reports. */
export type AlertJobSettings = Record<string, Record<string, number>>;

export interface AlertSource {
  id: string;
  label: string;
  description?: string;
  /** Custom job that reports for this source; enables the staleness watchdog and the on/off switch. */
  jobId?: string;
  reportedAt: string | null;
  /** Consecutive failed reports; reset by the next successful report. */
  failures: number;
  lastError?: string;
  /** Set once the "can't see its data" email for the current failure streak went out. */
  failureNotifiedAt?: string | null;
  /** Set once the "stopped reporting" email for the current stale episode went out. */
  staleNotifiedAt?: string | null;
  /** False when the owner turned this source's emails off; checks still run and show. Absent = on. */
  emails?: boolean;
  /** The adjustable numbers its job declared in the latest report. */
  settings?: AlertSettingSpec[];
  /** The owner's values for those settings, only where they differ from the default. */
  values?: Record<string, number>;
  checks: AlertCheck[];
  advice?: AlertAdvice;
  detail?: AlertDetail;
  /** Oldest first, pruned to 14 days. */
  series: AlertSeriesPoint[];
}

export type AlertNotificationKind = 'trip' | 'reminder' | 'blind';

export interface AlertNotification {
  at: string;
  sourceId: string;
  kind: AlertNotificationKind;
  subject: string;
  ok: boolean;
  checkIds: string[];
}

export interface AlertsStore {
  version: 1;
  sources: Record<string, AlertSource>;
  /** Newest first. */
  log: AlertNotification[];
}

/** Body of POST /api/alerts/report. */
export interface AlertReportInput {
  sourceId: string;
  label: string;
  description?: string;
  jobId?: string;
  /** The full current set: a check missing from a report counts as cleared. */
  checks: AlertCheckInput[];
  advice?: AlertAdvice;
  detail?: AlertDetail;
  /** One chart point for this report; the server stamps the time. */
  series?: Record<string, number | null>;
  /** Numbers the owner can adjust; a report without this list keeps the owner's values as they are. */
  settings?: AlertSettingSpec[];
}

/** The reporting job's stored manifest; the whole thing so a toggle can re-post it unchanged. */
export interface AlertJobInfo {
  id: string;
  label: string;
  schedule: string;
  script: string;
  enabled: boolean;
  tags: string[];
}

export type AlertSourceView = AlertSource & {
  job: AlertJobInfo | null;
  /** DATA_DIR/alerts/<id>/dashboard.html exists; the page shows it instead of the generic charts. */
  hasDashboard: boolean;
  /**
   * A job tagged "alerts" that has never reported, listed from its manifest so it can be turned
   * on. Nothing is stored for it, so it has no checks, emails switch or settings until it reports.
   */
  placeholder?: boolean;
};

/** GET /api/alerts */
export interface AlertsResponse {
  sources: AlertSourceView[];
  log: AlertNotification[];
}

/** Body of PUT /api/alerts/sources/:id/settings; send either or both. */
export interface AlertSourceSettings {
  emails?: boolean;
  /** Setting key → new value; null puts it back to the job's default. */
  values?: Record<string, number | null>;
}

/**
 * DocVault → dashboard frame, sent on load, on `docvault:alert:ready`, and after every poll.
 * The frame answers with `{ type: 'docvault:alert:ready' }` and `{ type: 'docvault:alert:height', height }`.
 */
export interface AlertDashboardMessage {
  type: 'docvault:alert';
  version: 1;
  source: AlertSourceView;
  theme: { mode: 'dark' | 'light'; colors: Record<string, string> };
}
