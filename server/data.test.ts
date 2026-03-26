import { expect, test, describe } from 'vite-plus/test';
import {
  getMimeType,
  monthsBetween,
  jsonResponse,
  corsHeaders,
  createSession,
  isValidSession,
  getSessionToken,
  sessionCookie,
  sessions,
  SESSION_COOKIE,
} from './data.js';

// --- getMimeType ---

describe('getMimeType', () => {
  test('returns correct MIME for common file types', () => {
    expect(getMimeType('document.pdf')).toBe('application/pdf');
    expect(getMimeType('photo.png')).toBe('image/png');
    expect(getMimeType('photo.jpg')).toBe('image/jpeg');
    expect(getMimeType('photo.jpeg')).toBe('image/jpeg');
    expect(getMimeType('animation.gif')).toBe('image/gif');
    expect(getMimeType('image.webp')).toBe('image/webp');
    expect(getMimeType('data.csv')).toBe('text/csv');
    expect(getMimeType('spreadsheet.xlsx')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    expect(getMimeType('page.html')).toBe('text/html');
    expect(getMimeType('data.json')).toBe('application/json');
    expect(getMimeType('file.txt')).toBe('text/plain');
  });

  test('returns octet-stream for unknown extensions', () => {
    expect(getMimeType('file.xyz')).toBe('application/octet-stream');
    expect(getMimeType('file.unknown')).toBe('application/octet-stream');
  });

  test('handles uppercase extensions', () => {
    // getMimeType lowercases the extension
    expect(getMimeType('FILE.PDF')).toBe('application/pdf');
    expect(getMimeType('FILE.PNG')).toBe('image/png');
  });

  test('handles no extension', () => {
    expect(getMimeType('README')).toBe('application/octet-stream');
  });

  test('handles office document formats', () => {
    expect(getMimeType('file.doc')).toBe('application/msword');
    expect(getMimeType('file.docx')).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
  });

  test('handles font types', () => {
    expect(getMimeType('font.woff')).toBe('font/woff');
    expect(getMimeType('font.woff2')).toBe('font/woff2');
    expect(getMimeType('font.ttf')).toBe('font/ttf');
  });

  test('handles Apple iWork formats', () => {
    expect(getMimeType('file.numbers')).toBe('application/x-iwork-numbers-sffnumbers');
    expect(getMimeType('file.pages')).toBe('application/x-iwork-pages-sffpages');
  });
});

// --- monthsBetween ---

describe('monthsBetween', () => {
  test('same month returns 0', () => {
    expect(monthsBetween('2025-01', '2025-01')).toBe(0);
  });

  test('one month apart', () => {
    expect(monthsBetween('2025-01', '2025-02')).toBe(1);
  });

  test('across years', () => {
    expect(monthsBetween('2024-11', '2025-02')).toBe(3);
  });

  test('full year', () => {
    expect(monthsBetween('2024-01', '2025-01')).toBe(12);
  });

  test('negative result for reversed dates', () => {
    expect(monthsBetween('2025-06', '2025-01')).toBe(-5);
  });

  test('multi-year span', () => {
    expect(monthsBetween('2023-01', '2026-03')).toBe(38);
  });
});

// --- jsonResponse ---

describe('jsonResponse', () => {
  test('returns JSON with CORS headers', () => {
    const res = jsonResponse({ foo: 'bar' });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/json');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  test('respects custom status code', () => {
    const res = jsonResponse({ error: 'not found' }, 404);
    expect(res.status).toBe(404);
  });

  test('body is valid JSON', async () => {
    const res = jsonResponse({ test: 123 });
    const body = await res.json();
    expect(body.test).toBe(123);
  });
});

// --- corsHeaders ---

describe('corsHeaders', () => {
  test('returns expected CORS headers', () => {
    const headers = corsHeaders();
    expect(headers['Access-Control-Allow-Origin']).toBe('*');
    expect(headers['Access-Control-Allow-Methods']).toContain('GET');
    expect(headers['Access-Control-Allow-Methods']).toContain('POST');
    expect(headers['Access-Control-Allow-Methods']).toContain('PUT');
    expect(headers['Access-Control-Allow-Methods']).toContain('DELETE');
    expect(headers['Access-Control-Allow-Headers']).toContain('Content-Type');
  });
});

// --- Session Management ---

describe('createSession', () => {
  test('creates a valid UUID token', () => {
    const token = createSession();
    expect(token).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  test('creates unique tokens', () => {
    const token1 = createSession();
    const token2 = createSession();
    expect(token1).not.toBe(token2);
  });

  test('token is stored in sessions map', () => {
    const token = createSession();
    expect(sessions.has(token)).toBe(true);
  });
});

describe('isValidSession', () => {
  test('returns true for valid, unexpired session', () => {
    const token = createSession();
    expect(isValidSession(token)).toBe(true);
  });

  test('returns false for unknown token', () => {
    expect(isValidSession('nonexistent-token')).toBe(false);
  });

  test('returns false for expired session', () => {
    const token = 'expired-test-token';
    sessions.set(token, Date.now() - 1000); // expired 1 second ago
    expect(isValidSession(token)).toBe(false);
    // Should also clean up the expired session
    expect(sessions.has(token)).toBe(false);
  });
});

describe('getSessionToken', () => {
  test('extracts token from cookie header', () => {
    const req = new Request('http://localhost', {
      headers: { cookie: `${SESSION_COOKIE}=abc123; other=def456` },
    });
    expect(getSessionToken(req)).toBe('abc123');
  });

  test('returns null when no cookie header', () => {
    const req = new Request('http://localhost');
    expect(getSessionToken(req)).toBeNull();
  });

  test('returns null when session cookie not present', () => {
    const req = new Request('http://localhost', {
      headers: { cookie: 'other_cookie=value' },
    });
    expect(getSessionToken(req)).toBeNull();
  });
});

describe('sessionCookie', () => {
  test('generates valid cookie string', () => {
    const cookie = sessionCookie('test-token');
    expect(cookie).toContain(`${SESSION_COOKIE}=test-token`);
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Max-Age=');
  });

  test('respects custom maxAge', () => {
    const cookie = sessionCookie('token', 3600);
    expect(cookie).toContain('Max-Age=3600');
  });
});
