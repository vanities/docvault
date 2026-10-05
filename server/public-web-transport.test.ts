// Synthetic socket responses only: verifies DNS pinning without opening a socket.
import { beforeEach, expect, test, vi } from 'vite-plus/test';
import type { RequestOptions } from 'node:http';
import { EventEmitter } from 'node:events';

const state = vi.hoisted(() => ({
  options: null as RequestOptions | null,
  calls: 0,
  large: false,
}));
vi.mock('node:https', () => ({
  request: (_url: URL, options: RequestOptions, callback: (response: EventEmitter) => void) => {
    state.options = options;
    state.calls++;
    const request = new EventEmitter() as EventEmitter & {
      setTimeout: () => void;
      destroy: (error: Error) => void;
      end: () => void;
    };
    request.setTimeout = () => {};
    request.destroy = (error) => {
      queueMicrotask(() => request.emit('error', error));
    };
    request.end = () =>
      queueMicrotask(() => {
        const response = Object.assign(new EventEmitter(), {
          statusCode: 302,
          headers: {
            location: 'http://127.0.0.1/private',
            'content-type': 'text/plain',
            'set-cookie': ['session=synthetic'],
            'content-length': '12',
          },
        });
        callback(response);
        response.emit('data', Buffer.from(state.large ? 'long synthetic content' : 'fixture'));
        if (!state.large) response.emit('end');
      });
    return request;
  },
}));
import { fetchPublicResource } from './public-web.js';
const resolver = async () => [{ address: '93.184.216.34', family: 4 }];
beforeEach(() => {
  state.options = null;
  state.calls = 0;
  state.large = false;
});

test('pins both single/all-address lookups and returns redirects without following them', async () => {
  const response = await fetchPublicResource('https://fixture.example.test/', { resolver });
  expect(state.calls).toBe(1);
  expect(response.status).toBe(302);
  expect(response.headers.location).toBe('http://127.0.0.1/private');
  expect(response.headers).not.toHaveProperty('set-cookie');
  expect(response.headers).not.toHaveProperty('content-length');
  const lookup = state.options!.lookup! as (...args: unknown[]) => void;
  const single = vi.fn(),
    all = vi.fn();
  lookup('rebound.example.test', {}, single);
  lookup('rebound.example.test', { all: true }, all);
  expect(single).toHaveBeenCalledWith(null, '93.184.216.34', 4);
  expect(all).toHaveBeenCalledWith(null, [{ address: '93.184.216.34', family: 4 }]);
});
test('rejects private DNS results and already-aborted requests before opening a socket', async () => {
  await expect(
    fetchPublicResource('https://fixture.example.test/', {
      resolver: async () => [{ address: '10.0.0.1', family: 4 }],
    })
  ).rejects.toThrow(/blocked/);
  const controller = new AbortController();
  controller.abort();
  await expect(
    fetchPublicResource('https://fixture.example.test/', { resolver, signal: controller.signal })
  ).rejects.toThrow();
  expect(state.calls).toBe(0);
});
test('stops oversized responses', async () => {
  state.large = true;
  await expect(
    fetchPublicResource('https://fixture.example.test/', { resolver, maxBytes: 2 })
  ).rejects.toThrow(/size limit/);
});

test('cancels a stalled DNS lookup without opening a socket', async () => {
  const controller = new AbortController();
  const fetch = fetchPublicResource('https://fixture.example.test/', {
    signal: controller.signal,
    resolver: () => new Promise(() => {}),
  });
  controller.abort(new Error('Synthetic cancellation'));
  await expect(fetch).rejects.toThrow('Synthetic cancellation');
  expect(state.calls).toBe(0);
});
