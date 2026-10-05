import { expect, test, vi } from 'vite-plus/test';
import { isPublicAddress, resolvePublicUrl } from './public-web.js';

test('rejects private, loopback, mapped, reserved and transition addresses', () => {
  for (const ip of [
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '192.168.1.2',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '192.0.2.1',
    '198.18.0.1',
    '224.0.0.1',
    '::1',
    '::ffff:127.0.0.1',
    'fc00::1',
    'fe80::1',
    '2001:db8::1',
    '2002:7f00:1::',
  ])
    expect(isPublicAddress(ip), ip).toBe(false);
  expect(isPublicAddress('93.184.216.34')).toBe(true);
  expect(isPublicAddress('2606:4700:4700::1111')).toBe(true);
});
test('validates every DNS answer and rejects unsafe URLs before networking', async () => {
  const resolver = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]);
  expect(
    (await resolvePublicUrl('https://fixture.example.test/article', resolver)).address.address
  ).toBe('93.184.216.34');
  for (const url of [
    'file:///etc/passwd',
    'https://user:secret@example.test/',
    'http://127.1/',
    'http://2130706433/',
    'http://[::ffff:127.0.0.1]/',
    'https://example.test:3005/',
  ])
    await expect(resolvePublicUrl(url, resolver)).rejects.toThrow();
  await expect(
    resolvePublicUrl('https://fixture.example.test', async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.1', family: 4 },
    ])
  ).rejects.toThrow(/blocked/);
});
