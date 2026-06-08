// IANA timezone choices for the Settings UI. Prefer the runtime's full list
// (Intl.supportedValuesOf), falling back to a common subset on the rare browser
// that lacks it. 'UTC' is pinned first since it's the server default.
export const TIMEZONE_OPTIONS: string[] = (() => {
  const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] })
    .supportedValuesOf;
  const zones =
    typeof supported === 'function'
      ? supported('timeZone')
      : [
          'America/New_York',
          'America/Chicago',
          'America/Denver',
          'America/Los_Angeles',
          'America/Anchorage',
          'Pacific/Honolulu',
          'Europe/London',
          'Europe/Paris',
          'Asia/Tokyo',
        ];
  return ['UTC', ...zones.filter((z) => z !== 'UTC')];
})();
