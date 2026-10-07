// UUID v4 generator that works in non-secure contexts. crypto.randomUUID()
// is restricted to HTTPS / localhost — DocVault often runs over HTTP on
// Unraid LAN IPs, so calling it throws "crypto.randomUUID is not a
// function". crypto.getRandomValues() has no such restriction, so we
// hand-roll the formatting from random bytes (RFC 4122 §4.4: set version
// + variant bits, hex-format with dashes).
export function uuidV4(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 1
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
