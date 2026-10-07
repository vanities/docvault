// Entirely invented tax records for native API and simulator verification.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function seedNativeTax(dataDir: string, pdf: Uint8Array) {
  const configPath = path.join(dataDir, '.docvault-config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  for (const [id, name] of [
    ['tax-demo', 'Tax Demo LLC'],
    ['tax-other', 'Other Tax Demo'],
  ]) {
    if (!config.entities.some((entity: { id: string }) => entity.id === id))
      config.entities.push({ id, name, color: 'orange', path: id, type: 'tax' });
    await mkdir(path.join(dataDir, id, '2025'), { recursive: true });
  }
  await writeFile(configPath, JSON.stringify(config));
  const documents: Record<string, Record<string, unknown> | null> = {
    'tax-demo/2026/income/w2/AcmeEmployer_W2_2026.pdf': {
      _documentType: 'w2',
      employerName: 'Acme Employer',
      wages: 42000,
      federalWithheld: 4000,
      stateWithheld: 1000,
    },
    'tax-other/2026/income/w2/AcmeEmployer_W2_2026.pdf': {
      _documentType: 'w2',
      employerName: 'Other Acme Employer',
      wages: 10000,
      federalWithheld: 500,
      stateWithheld: 0,
    },
    'tax-demo/2026/income/1099/AcmeClient_1099-NEC_2026.pdf': {
      _documentType: '1099-nec',
      payerName: 'Acme Client',
      nonemployeeCompensation: 8000,
    },
    'tax-demo/2026/income/1099/AcmeBank_1099-INT_2026.pdf': {
      _documentType: '1099-int',
      payerName: 'Acme Bank',
      interestIncome: 175,
    },
    'tax-demo/2026/income/1099/AcmeBroker_1099-B_2026.pdf': {
      _documentType: '1099-b',
      payerName: 'Acme Broker',
      shortTermGainLoss: -400,
      longTermGainLoss: 200,
    },
    'tax-demo/2026/income/other/AcmeClient_Invoice_2026-02.pdf': {
      _documentType: 'invoice',
      customer: 'Acme Client',
      amount: 6000,
      invoiceNumber: 'DEMO-1',
      date: '2026-02-15',
    },
    'tax-demo/2026/expenses/software/AcmeSoftware_Receipt.pdf': {
      _documentType: 'receipt',
      vendor: 'Acme Software',
      amount: 1200,
      category: 'software',
      date: '2026-02-01',
    },
    'tax-demo/2026/expenses/meals/AcmeCafe_Receipt.pdf': {
      _documentType: 'receipt',
      vendor: 'Acme Cafe',
      amount: 100,
      category: 'meals',
      date: '2026-02-02',
    },
    'tax-demo/2026/expenses/software/Untracked_Receipt.pdf': {
      _documentType: 'receipt',
      vendor: 'Untracked Acme',
      amount: 99990,
      category: 'software',
    },
    'tax-demo/2026/statements/bank/AcmeBank_Statement_2026-01.pdf': {
      _documentType: 'bank-statement',
      totalDeposits: 2500,
      deposits: [
        { date: '2026-01-03', description: 'Synthetic sale', amount: 2200 },
        { date: '2026-01-04', description: 'Online transfer from Acme Owner', amount: 300 },
      ],
    },
    'tax-demo/2026/statements/bank/AcmeBank_Statement_2026-02.pdf': {
      _documentType: 'bank-statement',
      totalDeposits: 0,
    },
    'tax-demo/2026/statements/bank/AcmeBank_Statement_2026-03.pdf': null,
    'tax-demo/2026/statements/retirement/AcmeRetirement_Statement_2026.pdf': {
      _documentType: 'retirement-statement',
      institution: 'Acme Retirement',
      accountType: '401(k)',
      totalContributions: 3000,
      employerContributions: 1000,
      employeeContributions: 2000,
    },
  };
  const parsedPath = path.join(dataDir, '.docvault-parsed.json');
  const parsed = JSON.parse(await readFile(parsedPath, 'utf8'));
  for (const key of Object.keys(parsed))
    if (key.startsWith('tax-demo/') || key.startsWith('tax-other/')) delete parsed[key];
  for (const [filename, value] of Object.entries(documents)) {
    await mkdir(path.dirname(path.join(dataDir, filename)), { recursive: true });
    await writeFile(path.join(dataDir, filename), pdf);
    if (value) parsed[filename] = value;
  }
  await writeFile(parsedPath, JSON.stringify(parsed));
  const metadataPath = path.join(dataDir, '.docvault-metadata.json');
  let metadata: Record<string, unknown> = {};
  try {
    metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
  } catch {
    /* new synthetic store */
  }
  metadata['tax-demo/2026/expenses/software/Untracked_Receipt.pdf'] = { tracked: false };
  await writeFile(metadataPath, JSON.stringify(metadata));
}
