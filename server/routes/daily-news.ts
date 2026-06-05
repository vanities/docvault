// Daily News routes — editions are background jobs the client starts + polls,
// plus a one-shot email test. Mirrors routes/deep-research.ts.
//
//   POST   /api/daily-news/run               { editionType? } → { id, status }
//   GET    /api/daily-news                    → { editions: [summary...] }   (history)
//   GET    /api/daily-news/:id                 → the full edition
//   GET    /api/daily-news/:id/edition.html    → downloadable newspaper HTML
//   DELETE /api/daily-news/:id                 → remove an edition
//   POST   /api/email/test                     → send a test email (verify Resend)

import { jsonResponse } from '../data.js';
import {
  startEdition,
  getEdition,
  listEditions,
  deleteEdition,
  type EditionType,
} from '../daily-news-store.js';
import { renderEditionHtml, editionFilename } from '../daily-news-report.js';
import { listThemes } from '../daily-news-themes.js';
import { readEditionImage } from '../daily-news-image.js';
import { sendEmail } from '../email.js';

/** Today's date in the server's local timezone as YYYY-MM-DD (matches the
 *  scheduler's local-date dedup key — see scheduler.ts). */
function localYMD(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

export async function handleDailyNewsRoutes(
  req: Request,
  _url: URL,
  pathname: string
): Promise<Response | null> {
  if (!pathname.startsWith('/api/daily-news') && pathname !== '/api/email/test') return null;

  // POST /api/email/test — fire a tiny test email so the user can verify their
  // Resend config + verified sending domain from the Settings UI.
  if (pathname === '/api/email/test' && req.method === 'POST') {
    const res = await sendEmail({
      subject: 'DocVault test email',
      html: '<p>This is a test email from DocVault. If you can read this, Resend is wired up correctly.</p>',
    });
    return jsonResponse(res, res.ok ? 200 : 400);
  }

  // POST /api/daily-news/run — generate now, return the id immediately
  if (pathname === '/api/daily-news/run' && req.method === 'POST') {
    const body = (await req.json().catch(() => ({}))) as { editionType?: unknown };
    const editionType: EditionType = body.editionType === 'weekly' ? 'weekly' : 'daily';
    const id = await startEdition(editionType, localYMD());
    return jsonResponse({ id, status: 'running' }, 201);
  }

  // GET /api/daily-news — history
  if (pathname === '/api/daily-news' && req.method === 'GET') {
    return jsonResponse({ editions: await listEditions() });
  }

  // GET /api/daily-news/themes — selectable house styles for the Settings dropdown
  if (pathname === '/api/daily-news/themes' && req.method === 'GET') {
    return jsonResponse({ themes: listThemes() });
  }

  // GET /api/daily-news/:id/image.png — the generated headline image (if any)
  const imgMatch = pathname.match(/^\/api\/daily-news\/([^/]+)\/image\.png$/);
  if (imgMatch && req.method === 'GET') {
    const bytes = await readEditionImage(decodeURIComponent(imgMatch[1]));
    if (!bytes) return jsonResponse({ error: 'no image' }, 404);
    return new Response(new Uint8Array(bytes), {
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=86400' },
    });
  }

  // GET /api/daily-news/:id/edition.html — downloadable self-contained newspaper
  const htmlMatch = pathname.match(/^\/api\/daily-news\/([^/]+)\/edition\.html$/);
  if (htmlMatch && req.method === 'GET') {
    const edition = await getEdition(decodeURIComponent(htmlMatch[1]));
    if (!edition || edition.status !== 'done') {
      return jsonResponse({ error: 'no completed edition' }, 404);
    }
    // Inline the headline image as a data URI so the download is self-contained.
    let heroSrc: string | undefined;
    if (edition.imagePath) {
      const bytes = await readEditionImage(edition.id);
      if (bytes) heroSrc = `data:image/png;base64,${bytes.toString('base64')}`;
    }
    return new Response(renderEditionHtml(edition, heroSrc), {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `attachment; filename="${editionFilename(edition)}.html"`,
      },
    });
  }

  // /api/daily-news/:id
  const match = pathname.match(/^\/api\/daily-news\/([^/]+)$/);
  if (match) {
    const id = decodeURIComponent(match[1]);
    if (req.method === 'GET') {
      const edition = await getEdition(id);
      return edition ? jsonResponse(edition) : jsonResponse({ error: 'not found' }, 404);
    }
    if (req.method === 'DELETE') {
      await deleteEdition(id);
      return jsonResponse({ ok: true });
    }
  }

  return null;
}
