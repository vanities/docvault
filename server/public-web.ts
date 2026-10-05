import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import ipaddr from 'ipaddr.js';

export function isPublicAddress(address: string): boolean {
  try {
    const ip = ipaddr.process(address);
    // IPv6 transition ranges can embed private IPv4 addresses; only plain global
    // unicast is accepted. Documentation, reserved, loopback, and LAN ranges fail.
    return ip.range() === 'unicast';
  } catch {
    return false;
  }
}

export type PublicResolver = (hostname: string) => Promise<{ address: string; family: number }[]>;
export async function resolvePublicUrl(
  raw: string,
  resolver: PublicResolver = (host) => lookup(host, { all: true })
) {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('Only public HTTP(S) URLs without credentials are supported');
  if (url.port && !['80', '443'].includes(url.port))
    throw new Error('Only standard web ports are supported');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = ipaddr.isValid(hostname)
    ? [{ address: hostname, family: ipaddr.parse(hostname).kind() === 'ipv4' ? 4 : 6 }]
    : await resolver(hostname);
  if (!addresses.length || addresses.some((v) => !isPublicAddress(v.address)))
    throw new Error('Local, private, and reserved network addresses are blocked');
  return { url, address: addresses[0]! };
}

export interface PublicResponse {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}

/** Resolve once and pin the socket to that public address (including TLS SNI).
 * The caller follows redirects through this function before rendering them. */
export async function fetchPublicResource(
  raw: string,
  options: { signal?: AbortSignal; maxBytes?: number; resolver?: PublicResolver } = {}
): Promise<PublicResponse> {
  options.signal?.throwIfAborted();
  // DNS lookup itself is not abortable in Node/Bun. Stop waiting when the
  // reader's deadline expires, while still handling the eventual DNS result.
  let abortLookup: (() => void) | undefined;
  const resolved = options.signal
    ? Promise.race([
        resolvePublicUrl(raw, options.resolver),
        new Promise<never>((_resolve, reject) => {
          abortLookup = () => reject(options.signal!.reason ?? new Error('Page read aborted'));
          options.signal!.addEventListener('abort', abortLookup, { once: true });
        }),
      ]).finally(() => {
        if (abortLookup) options.signal!.removeEventListener('abort', abortLookup);
      })
    : resolvePublicUrl(raw, options.resolver);
  const { url, address } = await resolved;
  options.signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
      url,
      {
        method: 'GET',
        signal: options.signal,
        family: address.family,
        lookup: (_host, lookupOptions, callback) => {
          // Bun requests all addresses even with family set; Node may request
          // a single answer. Both forms must return the same pinned address.
          if (lookupOptions.all) {
            (
              callback as unknown as (
                error: null,
                answers: { address: string; family: number }[]
              ) => void
            )(null, [address]);
          } else callback(null, address.address, address.family);
        },
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; DocVaultReader/1.0)',
          'Accept-Encoding': 'identity',
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > (options.maxBytes ?? 3_000_000)) {
            request.destroy(new Error('Page resource exceeds size limit'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('error', reject);
        response.on('end', () => {
          const headers: Record<string, string> = {};
          for (const [name, value] of Object.entries(response.headers)) {
            if (
              value !== undefined &&
              !['set-cookie', 'content-length', 'transfer-encoding', 'connection'].includes(name)
            )
              headers[name] = Array.isArray(value) ? value.join(', ') : value;
          }
          resolve({ status: response.statusCode ?? 502, headers, body: Buffer.concat(chunks) });
        });
      }
    );
    request.setTimeout(8000, () => request.destroy(new Error('Page resource timed out')));
    request.on('error', reject);
    request.end();
  });
}
