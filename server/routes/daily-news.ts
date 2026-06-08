// Daily News routes — editions are background jobs the client starts + polls,
// plus a one-shot email test. Mirrors routes/deep-research.ts.
//
//   POST   /api/daily-news/run               { editionType? } → { id, status }
//   GET    /api/daily-news                    → { editions: [summary...] }   (history)
//   GET    /api/daily-news/:id                 → the full edition
//   GET    /api/daily-news/:id/edition.html    → downloadable newspaper HTML
//   POST   /api/daily-news/:id/email           → email this edition on demand
//   DELETE /api/daily-news/:id                 → remove an edition
//   POST   /api/email/test                     → send a test email (verify Resend)

import { jsonResponse, loadSettings } from '../data.js';
import { getConfiguredTimezone, zonedYMD } from '../tz.js';
import {
  startEdition,
  startThemeSamples,
  getEdition,
  listEditions,
  deleteEdition,
  type EditionType,
} from '../daily-news-store.js';
import { notifyEditionReady } from '../daily-news.js';
import { renderEditionHtml, editionFilename } from '../daily-news-report.js';
import { listThemes, THEME_CYCLE } from '../daily-news-themes.js';
import { readEditionImage } from '../daily-news-image.js';
import { sendEmail } from '../email.js';

/** Today's date in the configured Daily News timezone as YYYY-MM-DD — matches
 *  the scheduler's per-day dedup key (see daily-news-schedule.ts) so a manual
 *  "generate now" lands on the same edition date as the scheduled one. */
async function todayYMD(): Promise<string> {
  const tz = getConfiguredTimezone((await loadSettings()).schedules);
  return zonedYMD(new Date(), tz);
}

export async function handleDailyNewsRoutes(
  req: Request,
  url: URL,
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

  // POST /api/daily-news/run — generate now, return the id immediately.
  // notify:false → an on-demand edition does NOT auto-email (only scheduled
  // editions do); the user sends it explicitly via POST /:id/email below.
  if (pathname === '/api/daily-news/run' && req.method === 'POST') {
    const body = (await req.json().catch(() => ({}))) as { editionType?: unknown };
    const editionType: EditionType = body.editionType === 'weekly' ? 'weekly' : 'daily';
    const id = await startEdition(editionType, await todayYMD(), undefined, false);
    return jsonResponse({ id, status: 'running' }, 201);
  }

  // POST /api/daily-news/:id/email — email a finished edition on demand. This is
  // the "split out" manual send: the generate button no longer auto-emails, so
  // this is how you push an edition to your inbox. Forces past the email.enabled
  // AUTO-delivery toggle (the click is the intent) but still needs Resend set up.
  const emailMatch = pathname.match(/^\/api\/daily-news\/([^/]+)\/email$/);
  if (emailMatch && req.method === 'POST') {
    const edition = await getEdition(emailMatch[1]);
    if (!edition) return jsonResponse({ error: 'Edition not found' }, 404);
    if (edition.status !== 'done') return jsonResponse({ error: 'Edition is not ready yet' }, 409);
    const result = await notifyEditionReady(edition, { force: true });
    if (!result.ok) return jsonResponse({ error: result.error ?? 'Send failed' }, 400);
    return jsonResponse({ ok: true });
  }

  // POST /api/daily-news/sample-themes — generate one sample edition per theme
  // (a "taste" of every house style) from a single shared digest. Returns the
  // ids immediately; the client polls history as each completes. Samples are
  // excluded from dedup and are never emailed.
  if (pathname === '/api/daily-news/sample-themes' && req.method === 'POST') {
    const body = (await req.json().catch(() => ({}))) as { editionType?: unknown };
    const editionType: EditionType = body.editionType === 'weekly' ? 'weekly' : 'daily';
    const { ids } = await startThemeSamples(editionType, await todayYMD());
    return jsonResponse({ ids, count: ids.length, status: 'running' }, 201);
  }

  // GET /api/daily-news — history
  if (pathname === '/api/daily-news' && req.method === 'GET') {
    return jsonResponse({ editions: await listEditions() });
  }

  // GET /api/daily-news/themes — selectable house styles for the Settings
  // dropdown, plus the special "cycle" meta-option (rotates styles by day).
  if (pathname === '/api/daily-news/themes' && req.method === 'GET') {
    return jsonResponse({ themes: listThemes(), cycle: THEME_CYCLE });
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

  // GET /api/daily-news/:id/edition.html — the self-contained newspaper HTML.
  //   ?inline=1 → render in the browser (the in-app iframe + "open in new tab")
  //   default   → Content-Disposition: attachment (the "Download HTML" button)
  // Same render, different disposition: an `attachment` response is DOWNLOADED by
  // the browser even inside an <iframe>, so inline viewing needs the header off.
  const htmlMatch = pathname.match(/^\/api\/daily-news\/([^/]+)\/edition\.html$/);
  if (htmlMatch && req.method === 'GET') {
    const edition = await getEdition(decodeURIComponent(htmlMatch[1]));
    if (!edition || edition.status !== 'done') {
      return jsonResponse({ error: 'no completed edition' }, 404);
    }
    // Inline the headline image as a data URI so the page is self-contained.
    let heroSrc: string | undefined;
    if (edition.imagePath) {
      const bytes = await readEditionImage(edition.id);
      if (bytes) heroSrc = `data:image/png;base64,${bytes.toString('base64')}`;
    }
    const inline = url.searchParams.get('inline') === '1';
    const headers: Record<string, string> = { 'Content-Type': 'text/html; charset=utf-8' };
    if (!inline) {
      headers['Content-Disposition'] = `attachment; filename="${editionFilename(edition)}.html"`;
    }
    return new Response(renderEditionHtml(edition, heroSrc), { headers });
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
