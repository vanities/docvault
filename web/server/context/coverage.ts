// What coverage.test.ts accepts for data files that no context source lists.
//
// Every file or folder the server keeps in the data folder must be one of:
//   1. listed in some source's `files` (registry.ts),
//   2. CONTEXT_EXEMPT here, with the reason it never belongs in AI context, or
//   3. CONTEXT_NOT_WIRED_YET here: owner data still waiting for its source.
// The not-wired list only shrinks. The test fails if an entry there is already
// listed by a source, so the list can't go stale.

export const CONTEXT_EXEMPT: Readonly<Record<string, string>> = {
  '.docvault-settings.json': 'API keys, secrets and app settings',
  '.rclone.conf': 'Dropbox credentials',
  '.docvault-config-backup.enc': 'encrypted copy of the other data files, for off-site backup',
  'sync-to-dropbox.sh': 'the Dropbox sync script, copied into the data folder',
  '.docvault-model-cache.json': 'the list of models each AI provider offers',
  '.docvault-cusip-cache.json': 'CUSIP-to-ticker lookup cache',
  '.docvault-crypto-prices.json': 'price cache used to value crypto holdings',
  '.docvault-backtest-prices.json': 'price cache for the politics backtest',
  '.docvault-headshots': 'legislator photos for the Politics page',
  '.docvault-form-templates.json': 'decoded PDF form field maps for Fill a Form',
  'gold-receipts':
    'scans of metals purchase receipts; the holdings they record are in the metals store',
  '.docvault-inbound-email.json':
    'ids of assignment reply emails already handled, so none is handled twice',
  '.docvault-reminders.json': 'legacy reminders, moved into the calendar on startup',
  '.docvault-reminders.backup.json': 'copy of the legacy reminders kept after the calendar move',
  '.taxvault-parsed.json': 'old name of the parsed-results file, renamed on startup',
  '.docvault-portfolio-snapshots.json':
    'old single-file net-worth history, split into per-year files and deleted on first read',
  'daily-news-audio': 'narration audio for editions whose text is in the editions file',
  'daily-news-images': 'header images for editions',
  skills: 'chat skill packs: instructions for the model, not records',
  'context-history': 'daily metric history, read back through each source’s changes',
  alerts: 'each alert source’s dashboard page; the data it shows is in the alerts store',
};

export const CONTEXT_NOT_WIRED_YET: Readonly<Record<string, string>> = {};
