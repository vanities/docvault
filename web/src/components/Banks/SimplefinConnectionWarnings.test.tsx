import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vite-plus/test';
import { SimplefinConnectionWarnings } from './SimplefinConnectionWarnings';

test('partial bank connections expose the provider reason and a reconnect action', () => {
  const html = renderToStaticMarkup(
    <SimplefinConnectionWarnings errors={['Acme Bank: Authentication required']} />
  );
  expect(html).toContain('Acme Bank: Authentication required');
  expect(html).toContain('Reconnect bank accounts');
  expect(html).toContain('https://beta-bridge.simplefin.org');
  expect(html).toContain('Balances may be out of date');
});

test('healthy bank syncs do not show a reconnect warning', () => {
  expect(renderToStaticMarkup(<SimplefinConnectionWarnings errors={[]} />)).toBe('');
});

test('temporary outages never instruct the user to reauthenticate', () => {
  const html = renderToStaticMarkup(
    <SimplefinConnectionWarnings errors={['Acme Bank: Temporarily unavailable']} />
  );
  expect(html).not.toContain('Reconnect bank accounts');
  expect(html).not.toContain('Reconnect the affected banks');
  expect(html).toContain('Temporarily unavailable');
});
