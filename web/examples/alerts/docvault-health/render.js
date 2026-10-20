// DocVault health dashboard. Assembled into dashboard.html by ../kit/assemble.ts; the kit
// supplies esc, card, headline, stats, chips, table, progress, lineChart and friends.
function render(source) {
  const d = source.detail && source.detail.kind === 'docvault-health' ? source.detail.data : null;
  if (!d) return '<div class="note">No DocVault health detail in the last report.</div>';
  const times = source.series.map((p) => p.t);
  const hoursText = (h) =>
    num(h) ? (h < 1 ? `${Math.round(h * 60)} min` : `${fmtNum(h, 1)} h`) : 'n/a';
  /** Clock time today, date and time otherwise: syncs run every few minutes, so a date alone says nothing. */
  const when = (iso) => {
    if (!iso) return 'n/a';
    const t = new Date(iso);
    const time = t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    return t.toDateString() === new Date().toDateString() ? time : `${day(iso)}, ${time}`;
  };

  // Backups (age is measured now, not at report time, so it never looks fresher than it is)
  const b = d.backup;
  const backupChecks = checksFor(source.checks, 'backup');
  const backupTone = worst(backupChecks);
  const liveAgeHours = b.lastSync ? (Date.now() - Date.parse(b.lastSync)) / 3.6e6 : b.ageHours;
  const backupBody = b.configured
    ? headline(
        hoursText(liveAgeHours),
        'since the last Dropbox sync',
        tag(
          b.errors ? `${b.errors} errors` : b.status === 'ok' ? 'Syncing' : b.status || 'Unknown',
          b.errors ? 'warning' : b.status === 'ok' ? '' : 'muted'
        ),
        backupTone === 'critical' ? 'bad' : backupTone === 'warning' ? 'warn' : ''
      ) +
      stats(
        stat('Last sync', esc(when(b.lastSync))),
        stat('Next sync', esc(when(b.nextSync))),
        stat('Entities', fmtNum(b.entitiesSynced, 0)),
        stat('Encrypted backup', esc(b.encryptedBackupAt ? ago(b.encryptedBackupAt) : 'off'))
      ) +
      chips(backupChecks) +
      `<div class="section">${lineChart({
        title: 'Hours since the last sync',
        series: [{ label: 'hours', values: seriesOf(source.series, 'backup.hoursSinceSync') }],
        refs: [{ value: 24, label: 'warns at' }],
        times,
        fmt: (n) => `${fmtNum(n, 0)} h`,
        current: hoursText(liveAgeHours),
      })}</div>`
    : headline(
        'Off',
        'Dropbox sync is not set up, so there is no backup to watch.',
        tag('Not set up', 'muted')
      );

  // Email
  const e = d.email;
  const emailChecks = checksFor(source.checks, 'email');
  const emailRows = e.recent.map((x) => [
    esc(
      new Date(x.at).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    ),
    esc(x.purpose),
    x.ok ? '<span class="good">sent</span>' : '<span class="bad">failed</span>',
  ]);
  const emailBody =
    headline(
      `${e.failed24h}`,
      `${e.failed24h === 1 ? 'send' : 'sends'} failed in the last 24 h, ${e.sent24h} went out`,
      tag(e.failed24h ? 'Failing' : 'Working', e.failed24h ? 'warning' : ''),
      e.failed24h ? 'warn' : ''
    ) +
    chips(emailChecks) +
    table(
      [{ label: 'When' }, { label: 'Purpose' }, { label: 'Result' }],
      emailRows,
      'No email sent yet.'
    );

  // Jobs, failing first
  const jobChecks = checksFor(source.checks, 'jobs');
  const order = { failing: 0, stale: 1, new: 2, ok: 3, off: 4 };
  const jobs = [...d.jobs].sort(
    (a, b2) => order[a.state] - order[b2.state] || a.label.localeCompare(b2.label)
  );
  const stateTag = {
    failing: tag('Failing', 'critical'),
    stale: tag('Stale', 'warning'),
    new: tag('Not run yet', 'muted'),
    ok: tag('OK'),
    off: tag('Off', 'muted'),
  };
  const running = d.jobs.filter((j) => j.enabled).length;
  const failingCount = d.jobs.filter((j) => j.state === 'failing').length;
  const jobRows = jobs.map((j) => [
    stateTag[j.state],
    `${esc(j.label)}${j.lastError && j.state !== 'ok' ? `<div class="muted">${esc(j.lastError.slice(0, 120))}</div>` : ''}`,
    esc(j.kind),
    esc(j.schedule),
    esc(ago(j.lastSuccessAt)),
    j.failures
      ? `<span class="${j.state === 'failing' ? 'bad' : 'warn'}">${j.failures}</span>`
      : '0',
  ]);
  const jobsBody =
    headline(
      `${failingCount}`,
      `of ${running} running ${running === 1 ? 'job is' : 'jobs are'} failing`,
      '',
      failingCount ? 'bad' : ''
    ) +
    chips(jobChecks) +
    table(
      [
        { label: 'State' },
        { label: 'Job' },
        { label: 'Kind' },
        { label: 'Schedule' },
        { label: 'Last success' },
        { label: 'Failures', num: true },
      ],
      jobRows,
      'No scheduled jobs.'
    ) +
    `<div class="section">${lineChart({
      title: 'Failing jobs',
      series: [{ label: 'failing', values: seriesOf(source.series, 'jobs.failing') }],
      times,
      fmt: (n) => fmtNum(n, 0),
      current: `${failingCount}`,
    })}</div>`;

  // Disk
  const disk = d.disk;
  const diskChecks = checksFor(source.checks, 'disk');
  const diskTone = worst(diskChecks);
  const diskBody =
    headline(
      pct(disk.usedPct),
      `used, ${fmtNum(disk.freeGb, 0)} GB free of ${fmtNum(disk.totalGb, 0)} GB`,
      '',
      diskTone === 'critical' ? 'bad' : diskTone === 'warning' ? 'warn' : ''
    ) +
    progress(disk.usedPct, 100, {
      mark: 90,
      color: disk.usedPct >= 90 ? 'var(--bad)' : 'var(--ok)',
    }) +
    chips(diskChecks) +
    `<div class="section">${lineChart({
      title: 'Space used',
      series: [{ label: 'used', values: seriesOf(source.series, 'disk.usedPct') }],
      refs: [{ value: 90, label: 'warns at' }],
      times,
      fmt: (n) => `${fmtNum(n, 0)}%`,
      current: pct(disk.usedPct),
    })}</div>`;

  return [
    card({ eyebrow: 'Backups', tone: backupTone, body: backupBody }),
    card({ eyebrow: 'Email', tone: worst(emailChecks), body: emailBody }),
    card({ eyebrow: 'Scheduled jobs', tone: worst(jobChecks), wide: true, body: jobsBody }),
    card({ eyebrow: 'Data drive', tone: diskTone, body: diskBody }),
  ].join('');
}
