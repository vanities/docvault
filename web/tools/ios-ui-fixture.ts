// Isolated integration-test server. Uses the real request handler and built
// frontend, but only fabricated records in a temporary directory. No schedulers.
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { serve } from 'bun';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { seedNativeMarkets } from './ios-market-fixture';
import { seedNativeHealth } from './ios-health-fixture';
import { seedNativeFinance } from './ios-finance-fixture';
import { seedNativeNutrition } from './ios-nutrition-fixture';
import { seedNativeTax } from './ios-tax-fixture';
import { clearNativeSnapshot, seedNativeSnapshot } from './ios-snapshot-fixture';
import { seedNativeBusiness, syntheticGeocode } from './ios-business-fixture';
import { seedNativeOperations } from './ios-operations-fixture';
import { seedNativeAdministration } from './ios-administration-fixture';
import {
  seedNativeResearch,
  syntheticResearchRunner,
  syntheticNewsGenerator,
} from './ios-research-fixture';

const dataDir = await mkdtemp(path.join(tmpdir(), 'docvault-ios-ui-'));
process.env.DOCVAULT_DATA_DIR = dataDir;
process.env.DOCVAULT_USERNAME = 'admin';
process.env.DOCVAULT_PASSWORD = 'synthetic-password';
process.env.ANTHROPIC_API_KEY = '';
process.env.DOCVAULT_MASTER_KEY = 'synthetic-test-only-master-key';
process.env.OPENAI_API_KEY = '';
// Keep host-side Codex authentication out of the synthetic server's settings.
await writeFile(
  path.join(dataDir, '.docvault-settings.json'),
  JSON.stringify({ chat: { codexHome: path.join(dataDir, 'synthetic-codex-home') } })
);
await mkdir(path.join(dataDir, 'acme', '2026 taxes', 'Statements'), { recursive: true });
await writeFile(
  path.join(dataDir, '.docvault-config.json'),
  JSON.stringify({
    entities: [
      {
        id: 'acme',
        name: 'Acme Test Vault',
        color: 'blue',
        path: 'acme',
        type: 'tax',
        metadata: { homeOfficeDeduction: '500' },
      },
    ],
  })
);
const pdf = await PDFDocument.create();
const page = pdf.addPage();
const font = await pdf.embedFont(StandardFonts.Helvetica);
page.drawText('DocVault - synthetic integration document', { x: 40, y: 700, font, size: 18 });
await writeFile(
  path.join(dataDir, 'acme', '2026 taxes', 'Statements', 'Acme Statement #1.pdf'),
  await pdf.save()
);
const worksheetDocuments = {
  '2026/statements/bank/AcmeBank_Statement_2026-12.pdf': {
    _documentType: 'bank-statement',
    totalDeposits: 25000,
    endingBalance: 6000,
    endDate: '2026-12-31',
  },
  '2026/income/Acme_Invoice.pdf': { _documentType: 'invoice', amount: 18000 },
  '2026/expenses/software/Synthetic_Receipt.pdf': {
    _documentType: 'receipt',
    vendor: 'Acme Software',
    amount: 2000,
    category: 'software',
  },
};
for (const filename of Object.keys(worksheetDocuments)) {
  await mkdir(path.dirname(path.join(dataDir, 'acme', filename)), { recursive: true });
  await writeFile(path.join(dataDir, 'acme', filename), await pdf.save());
}
await writeFile(
  path.join(dataDir, '.docvault-parsed.json'),
  JSON.stringify(
    Object.fromEntries(
      Object.entries(worksheetDocuments).map(([filename, parsed]) => [`acme/${filename}`, parsed])
    )
  )
);
// Provider access is forbidden in this fixture; empty vault reads must be safe offline.
let businessProviderEnabled = false;
globalThis.fetch = ((input: string | URL | Request) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (businessProviderEnabled && url.hostname === 'api.geoapify.com') {
    return Promise.resolve(syntheticGeocode(url));
  }
  return Promise.reject(new Error('External network disabled in synthetic iOS fixture'));
}) as unknown as typeof fetch;
await seedNativeHealth(dataDir);
await seedNativeNutrition(dataDir);
const form = pdf.getForm();
const text = form.createTextField('DemoName');
text.addToPage(page, { x: 40, y: 620, width: 250, height: 30 });
const check = form.createCheckBox('DemoConsent');
check.addToPage(page, { x: 40, y: 580, width: 20, height: 20 });
await writeFile(
  path.join(dataDir, 'acme', '2026 taxes', 'Statements', 'Synthetic Form.pdf'),
  await pdf.save()
);
const { extractFormLayout, formFingerprint } = await import('../server/pdf-forms');
const layout = await extractFormLayout(await pdf.save());
const fingerprint = formFingerprint(layout);
await writeFile(
  path.join(dataDir, '.docvault-form-templates.json'),
  JSON.stringify({
    [fingerprint]: {
      fingerprint,
      formName: 'Synthetic Form',
      decodedAt: new Date().toISOString(),
      fieldCount: layout.length,
      fields: { DemoName: { label: 'Demo name' }, DemoConsent: { label: 'Demo consent' } },
    },
  })
);
const marketDisclosure = await pdf.save();
await seedNativeMarkets(dataDir, marketDisclosure);
await seedNativeFinance(dataDir);
await seedNativeTax(dataDir, marketDisclosure);
const { handleRequest } = await import('../server/index');
await seedNativeAdministration(dataDir);
let failAdministrationSave = false;
const counters = { settings: 0, documents: 0 };
const server = serve({
  maxRequestBodySize: 2 * 1024 * 1024 * 1024,
  hostname: '127.0.0.1',
  port: Number(process.env.DOCVAULT_UI_TEST_PORT || 31305),
  async fetch(req) {
    const pathname = new URL(req.url).pathname;
    if (pathname === '/__test/reset-administration' && req.method === 'POST') {
      await seedNativeAdministration(dataDir);
      failAdministrationSave = false;
      return Response.json({ ok: true });
    }
    if (pathname === '/__test/fail-administration-save' && req.method === 'POST') {
      failAdministrationSave = true;
      return Response.json({ ok: true });
    }
    if (failAdministrationSave && req.method === 'PUT' && pathname === '/api/brain') {
      failAdministrationSave = false;
      return Response.json(
        { error: 'Synthetic save failed; your draft must remain.' },
        { status: 503 }
      );
    }
    if (pathname === '/__test/reset-research' && req.method === 'POST') {
      await seedNativeResearch(dataDir, marketDisclosure);
      return Response.json({ ok: true });
    }
    if (pathname === '/__test/reset-research-empty-file' && req.method === 'POST') {
      await seedNativeResearch(dataDir, marketDisclosure);
      await writeFile(path.join(dataDir, 'research', 'financepdf.pdf'), '');
      return Response.json({ ok: true });
    }
    // A full device suite can outlive the market cache TTL. Reset only these
    // fabricated records before a flow; keep the production cache policy intact.
    if (pathname === '/__test/reset-business' && req.method === 'POST') {
      await seedNativeBusiness(dataDir);
      businessProviderEnabled = true;
      return Response.json({ ok: true });
    }
    if (pathname === '/__test/reset-business-empty' && req.method === 'POST') {
      await seedNativeBusiness(dataDir, true);
      businessProviderEnabled = false;
      return Response.json({ ok: true });
    }
    if (pathname === '/__test/reset-operations' && req.method === 'POST') {
      await seedNativeOperations(dataDir);
      return Response.json({ ok: true });
    }
    if (pathname === '/__test/reset-markets' && req.method === 'POST') {
      await seedNativeMarkets(dataDir, marketDisclosure);
      return Response.json({ ok: true });
    }
    if (pathname === '/__test/reset-finance' && req.method === 'POST') {
      await seedNativeFinance(dataDir);
      return Response.json({ ok: true });
    }
    if (pathname === '/__test/reset-nutrition' && req.method === 'POST') {
      await seedNativeNutrition(dataDir);
      return Response.json({ ok: true });
    }
    if (pathname === '/__test/reset-tax' && req.method === 'POST') {
      await clearNativeSnapshot(dataDir);
      await seedNativeTax(dataDir, marketDisclosure);
      return Response.json({ ok: true });
    }
    if (pathname === '/__test/reset-snapshot' && req.method === 'POST') {
      await seedNativeSnapshot(dataDir, marketDisclosure);
      return Response.json({ ok: true });
    }
    if (pathname === '/__test/reset-snapshot-empty' && req.method === 'POST') {
      await clearNativeSnapshot(dataDir);
      return Response.json({ ok: true });
    }
    if (pathname === '/__test/reset-worksheets' && req.method === 'POST') {
      await writeFile(path.join(dataDir, '.docvault-contributions.json'), '{}');
      return Response.json({ ok: true });
    }
    if (pathname === '/__test/empty-politics' && req.method === 'POST') {
      const politicsPath = path.join(dataDir, '.docvault-politics.json');
      const politics = JSON.parse(await readFile(politicsPath, 'utf8'));
      politics.generatedAt = null;
      politics.trades = [];
      politics.bills = [];
      await writeFile(politicsPath, JSON.stringify(politics));
      const researchPath = path.join(dataDir, '.docvault-research.json');
      const research = JSON.parse(await readFile(researchPath, 'utf8'));
      research.entries = Object.fromEntries(
        Object.entries(research.entries).filter(
          ([, value]) => (value as { domain: string }).domain !== 'politics'
        )
      );
      await writeFile(researchPath, JSON.stringify(research));
      return Response.json({ ok: true });
    }
    if (pathname === '/__test/counters') return Response.json(counters);
    if (pathname === '/__test/stream') {
      const end = new URL(req.url).searchParams.get('end');
      const terminal =
        end === 'invalid'
          ? 'data: invalid\n\n'
          : end === 'truncated'
            ? ''
            : 'data: {"type":"done"}\n\n';
      return new Response(
        ': heartbeat\n\ndata: {"type":"text","text":"Synthetic reply"}\n\n' + terminal,
        {
          headers: { 'Content-Type': 'text/event-stream' },
        }
      );
    }
    const response = await handleRequest(req, {
      research: syntheticResearchRunner,
      news: syntheticNewsGenerator,
      jobs: { restartCustomJobScheduler: async () => {} },
    });
    if (response.status === 200 && pathname === '/api/settings') counters.settings++;
    if (response.status === 200 && pathname.startsWith('/api/file/')) counters.documents++;
    return response;
  },
});
console.log(`Synthetic iOS fixture ready: http://127.0.0.1:${server.port}`);
async function shutdown() {
  await server.stop(true);
  await rm(dataDir, { recursive: true, force: true });
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
