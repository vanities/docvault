export function SimplefinConnectionWarnings({ errors }: { errors?: string[] }) {
  if (!errors?.length) return null;
  return (
    <div
      role="status"
      className="p-4 mb-4 rounded-xl border border-amber-500/20 bg-amber-500/10 text-sm"
    >
      <p className="font-medium text-amber-500">Bank connections need attention</p>
      <ul className="mt-2 space-y-1 text-surface-700">
        {errors.map((error, index) => (
          <li key={index}>{error}</li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-surface-600">
        Reconnect the affected banks in SimpleFIN Bridge, then sync again. Balances may be out of
        date until the connection is restored.
      </p>
      <a
        href="https://beta-bridge.simplefin.org"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block mt-2 text-accent-500 hover:underline"
      >
        Reconnect bank accounts
      </a>
    </div>
  );
}
