// Invented regimen and label records. Never copy health data into this fixture.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Buffer } from 'node:buffer';
import sharp from 'sharp';

export async function seedNativeNutrition(dataDir: string) {
  const storePath = path.join(dataDir, '.docvault-health.json');
  const store = JSON.parse(await readFile(storePath, 'utf8'));
  const now = '2026-10-06T12:00:00Z';
  const folder = path.join(dataDir, 'health/demo-person/nutrition');
  await mkdir(folder, { recursive: true });
  const front = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="680" height="460"><rect width="680" height="460" rx="30" fill="#def4eb"/><rect x="210" y="80" width="260" height="310" rx="50" fill="white"/><rect x="250" y="48" width="180" height="75" rx="18" fill="#147d70"/><rect x="210" y="170" width="260" height="145" fill="#147d70"/><g font-family="sans-serif" text-anchor="middle"><text x="340" y="208" fill="#c9ece2" font-size="18">ACME NUTRITION</text><text x="340" y="248" fill="white" font-size="29">Daily Demo</text><text x="340" y="285" fill="white" font-size="16">FICTIONAL PRODUCT</text><text x="340" y="430" fill="#147d70" font-size="17">Synthetic label for UI testing</text></g></svg>'
  );
  const facts = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="680" height="460"><rect width="680" height="460" rx="24" fill="#fafafa"/><g font-family="sans-serif" fill="#162d28"><text x="45" y="65" font-size="33" font-weight="bold">Demo Supplement Facts</text><text x="45" y="100" font-size="20">Serving size: 2 fictional capsules</text><path d="M45 125h590M45 220h590M45 285h590" stroke="#162d28" stroke-width="3"/><text x="45" y="170" font-size="22">Vitamin C</text><text x="430" y="170" font-size="22">90 mg</text><text x="555" y="170" font-size="22">100%</text><text x="45" y="205" font-size="22">Vitamin D</text><text x="430" y="205" font-size="22">25 mcg</text><text x="555" y="205" font-size="22">125%</text><text x="45" y="260" font-size="22">Demo blend</text><text x="430" y="260" font-size="22">150 mg</text><text x="45" y="345" font-size="20">Invented values. No clinical guidance.</text><text x="45" y="390" font-size="18">Synthetic label for integration tests.</text></g></svg>'
  );
  await writeFile(path.join(folder, 'demodaily.front.png'), await sharp(front).png().toBuffer());
  await writeFile(path.join(folder, 'demodaily.facts.png'), await sharp(facts).png().toBuffer());
  const base = {
    personId: 'demo-person',
    filename: null,
    imagePath: '',
    imageMediaType: 'image/png',
    uploadedAt: now,
    parsedAt: now,
    lastUpdated: now,
    parseError: null,
  };
  const parsed = {
    schemaVersion: 1,
    parserVersion: '1.0.0+synthetic',
    brandName: 'Acme Nutrition',
    productName: 'Daily Demo',
    category: 'multivitamin',
    servingSize: { amount: 2, unit: 'capsules', description: 'Fictional label serving' },
    servingsPerContainer: 'about 30',
    macros: {
      calories: 0,
      totalFat: { name: 'Total Fat', amount: 0, unit: 'g', dv: 0 },
      protein: { name: 'Protein', amount: 0, unit: 'g' },
    },
    vitamins: [
      { name: 'Vitamin C', amount: 90, unit: 'mg', dv: 100, form: 'Synthetic label form' },
      { name: 'Vitamin D', amount: 25, unit: 'mcg', dv: 125 },
    ],
    minerals: [{ name: 'Demo mineral', amount: 0, unit: 'mg', dv: 0, notes: 'Zero is recorded.' }],
    otherActive: [{ name: 'Demo extract', amount: 50, unit: 'mg' }],
    proprietaryBlends: [
      {
        name: 'Demo blend',
        totalAmount: { amount: 150, unit: 'mg' },
        ingredients: ['Fictional ingredient A', 'Fictional ingredient B'],
      },
    ],
    ingredients: ['Fictional capsule shell'],
    allergenInfo: ['Synthetic allergen statement.'],
    directions: 'Fictional label directions for testing only.',
    warnings: ['Synthetic warning text.'],
    parserNotes: 'All values are invented for UI verification.',
  };
  const entries = [
    {
      ...base,
      id: 'demodaily',
      status: 'active',
      parsed,
      dose: { amount: 1, unit: 'capsule', frequency: 'daily', timeOfDay: 'morning' },
      filename: 'Daily Demo.png',
      imagePath: 'health/demo-person/nutrition/demodaily.front.png',
      factsImagePath: 'health/demo-person/nutrition/demodaily.facts.png',
      factsImageMediaType: 'image/png',
      factsFilename: 'Daily Demo Facts.png',
      notes: 'Synthetic regimen note.',
      research: '**Saved note:** fictional research for testing, with no medical recommendation.',
      citations: [
        {
          id: 'demoref',
          title: 'Fictional nutrition evidence',
          authors: 'Demo Research Group',
          year: 2026,
          journal: 'Synthetic Journal',
          findings: 'Invented findings used to verify citation rendering.',
          url: 'https://example.com/fictional-research',
          pmid: 'DEMO',
          doi: 'synthetic-only',
        },
      ],
    },
    {
      ...base,
      id: 'demoprotein',
      status: 'active',
      parsed: {
        schemaVersion: 1,
        parserVersion: '1.0.0+text',
        brandName: 'Acme Nutrition',
        productName: 'Demo Protein',
        category: 'protein',
        servingSize: { amount: 1, unit: 'scoop' },
        macros: { calories: 120, protein: { name: 'Protein', amount: 24, unit: 'g' } },
      },
      dose: { amount: 1, unit: 'scoop', frequency: 'as-needed', timeOfDay: 'post-workout' },
    },
    {
      ...base,
      id: 'demofiber',
      status: 'active',
      parsed: {
        schemaVersion: 1,
        parserVersion: '1.0.0+text',
        brandName: 'Acme Nutrition',
        productName: 'Demo Fiber',
        category: 'fiber',
      },
      dose: { frequency: 'custom', frequencyCustom: 'Fictional schedule only' },
    },
    {
      ...base,
      id: 'demomineral',
      status: 'considering',
      parsed: {
        schemaVersion: 1,
        parserVersion: '1.0.0+text',
        brandName: 'Acme Nutrition',
        productName: 'Demo Mineral',
        category: 'mineral',
      },
    },
    {
      ...base,
      id: 'demopast',
      status: 'past',
      parsed: {
        schemaVersion: 1,
        parserVersion: '1.0.0+text',
        brandName: 'Acme Nutrition',
        productName: 'Past Demo',
        category: 'other',
      },
    },
    {
      ...base,
      id: 'demounparsed',
      status: 'never',
      parsed: null,
      filename: 'Unparsed Demo Label.png',
      imagePath: 'health/demo-person/nutrition/missing.png',
      parsedAt: null,
      parseError: 'Synthetic extraction unavailable. The image record is retained.',
    },
    {
      ...base,
      id: 'otherdemo',
      personId: 'other-person',
      status: 'considering',
      parsed: {
        schemaVersion: 1,
        parserVersion: '1.0.0+text',
        brandName: 'Other Demo Brand',
        productName: 'Other Person Product',
        category: 'other',
      },
    },
  ];
  store.nutrition = Object.fromEntries(
    entries.map((entry) => [entry.personId + '/' + entry.id, entry])
  );
  await writeFile(storePath, JSON.stringify(store));
}
