// Invoices dashboard. Assembled into dashboard.html by ../kit/assemble.ts; the kit supplies
// esc, card, headline, stats, chips, table, hbars, lineChart and friends.
function render(source) {
  const d = source.detail && source.detail.kind === 'overdue-invoices' ? source.detail.data : null;
  if (!d) return '<div class="note">No invoice detail in the last report.</div>';
  const times = source.series.map((p) => p.t);
  const money = (n, currency = d.currency) =>
    num(n) ? (currency === 'USD' ? usd(n, 2) : `${esc(currency)} ${fmtNum(n, 2)}`) : 'n/a';
  const checks = checksFor(source.checks, 'invoices');
  const tone = worst(checks);

  const open = d.open;
  const inCurrency = open.filter((i) => i.currency === d.currency);
  const outstanding = inCurrency.reduce((a, i) => a + i.total, 0);
  const pastDue = inCurrency.filter((i) => i.daysOverdue > 0);
  const pastDueTotal = pastDue.reduce((a, i) => a + i.total, 0);
  const oldest = open.length ? Math.max(...open.map((i) => i.daysOverdue)) : 0;

  const summary =
    headline(
      money(outstanding),
      `owed on ${open.length} open ${open.length === 1 ? 'invoice' : 'invoices'}, ${money(pastDueTotal)} of it past due`,
      tag(tone === 'critical' ? 'Act now' : tone === 'warning' ? 'Late' : 'On time', tone || ''),
      tone === 'critical' ? 'bad' : tone === 'warning' ? 'warn' : ''
    ) +
    stats(
      stat('Oldest past due', `${oldest} d`, oldest >= 30 ? 'bad' : oldest >= 7 ? 'warn' : ''),
      stat('Paid, last 90 days', money(d.paid90.total)),
      stat('Invoices paid', fmtNum(d.paid90.count, 0))
    ) +
    chips(checks) +
    `<div class="section"><div class="eyebrow">Aging</div>${hbars([
      { label: 'Not yet due', value: d.aging.current, display: money(d.aging.current) },
      {
        label: '1 to 30 days',
        value: d.aging.d1_30,
        display: money(d.aging.d1_30),
        color: 'var(--warn)',
      },
      {
        label: '31 to 60 days',
        value: d.aging.d31_60,
        display: money(d.aging.d31_60),
        color: 'var(--bad)',
      },
      {
        label: 'Over 60 days',
        value: d.aging.d60plus,
        display: money(d.aging.d60plus),
        color: 'var(--bad)',
      },
    ])}</div>`;

  const trend =
    lineChart({
      title: 'Owed vs past due',
      series: [
        { label: 'owed', values: seriesOf(source.series, 'invoices.outstanding') },
        {
          label: 'past due',
          values: seriesOf(source.series, 'invoices.overdue'),
          color: 'var(--bad)',
        },
      ],
      times,
      fmt: (n) => money(n),
      current: money(outstanding),
    }) +
    `<div class="section">${lineChart({
      title: 'Unbilled hours',
      series: [
        {
          label: 'hours',
          values: seriesOf(source.series, 'invoices.unbilledHours'),
          color: 'var(--warn)',
        },
      ],
      times,
      fmt: (n) => `${fmtNum(n, 1)} h`,
      current: `${fmtNum(
        d.unbilled.reduce((a, r) => a + r.hours, 0),
        1
      )} h`,
    })}</div>`;

  const lateClass = (days) => (days >= 30 ? 'bad' : days >= 7 ? 'warn' : '');
  const openRows = open.map((i) => {
    const cls = lateClass(i.daysOverdue);
    const wrap = (s) => (cls ? `<span class="${cls}">${s}</span>` : s);
    return [
      wrap(esc(i.number)),
      esc(i.clientName),
      esc(day(i.issueDate)),
      esc(day(i.dueDate)),
      wrap(i.daysOverdue ? `${i.daysOverdue} d` : 'not yet'),
      wrap(money(i.total, i.currency)),
    ];
  });

  const unbilledHours = d.unbilled.reduce((a, r) => a + r.hours, 0);
  const unbilledAmount = d.unbilled.reduce((a, r) => a + r.amount, 0);
  const unbilledRows = d.unbilled.map((r) => [
    esc(r.clientName),
    esc(r.projectName),
    `${fmtNum(r.hours, 1)} h`,
    money(r.amount),
    esc(day(r.oldestDate)),
  ]);

  return [
    card({ eyebrow: 'Outstanding', tone, body: summary }),
    card({ eyebrow: 'Trend', body: trend }),
    card({
      eyebrow: 'Open invoices',
      wide: true,
      body: table(
        [
          { label: 'Invoice' },
          { label: 'Client' },
          { label: 'Issued' },
          { label: 'Due' },
          { label: 'Past due', num: true },
          { label: 'Total', num: true },
        ],
        openRows,
        'No open invoices.'
      ),
    }),
    card({
      eyebrow: 'Unbilled time',
      wide: true,
      tone: worst(source.checks.filter((c) => c.id === 'invoices:unbilled')),
      body:
        headline(
          `${fmtNum(unbilledHours, 1)} h`,
          `billable time from before this month on no invoice${unbilledHours ? `, about ${money(unbilledAmount)}` : ''} (since ${esc(day(d.unbilledSince))})`
        ) +
        table(
          [
            { label: 'Client' },
            { label: 'Project' },
            { label: 'Hours', num: true },
            { label: 'Amount', num: true },
            { label: 'Oldest' },
          ],
          unbilledRows,
          'All earlier billable time is on an invoice.'
        ),
    }),
  ].join('');
}
