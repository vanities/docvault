// Tests for server/pdf-forms.ts
//
// Committed to git (exception in .gitignore): the fixture is a fillable PDF
// built in-memory with fabricated field names/values — no personal data.

import { describe, test, expect } from 'vite-plus/test';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { PDFDocument } from 'pdf-lib';
import {
  extractFormFields,
  extractFormLayout,
  fillFormFields,
  formFingerprint,
  hasFormFields,
} from './pdf-forms.js';
import { decodeForm, type DecodeFn } from './pdf-form-decode.js';

/** Build a small fillable PDF: text + checkbox + dropdown + a read-only text field. */
async function buildFixtureForm(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 400]);
  const form = doc.getForm();

  const name = form.createTextField('applicant.name');
  name.addToPage(page, { x: 50, y: 320, width: 200, height: 20 });

  const agree = form.createCheckBox('agree');
  agree.addToPage(page, { x: 50, y: 280, width: 15, height: 15 });

  const status = form.createDropdown('status');
  status.setOptions(['Pending', 'Approved', 'Rejected']);
  status.addToPage(page, { x: 50, y: 240, width: 120, height: 20 });

  const locked = form.createTextField('locked');
  locked.setText('original');
  locked.enableReadOnly();
  locked.addToPage(page, { x: 50, y: 200, width: 120, height: 20 });

  return doc.save();
}

describe('pdf-forms', () => {
  test('hasFormFields detects fillable fields (and not a blank PDF)', async () => {
    expect(await hasFormFields(await buildFixtureForm())).toBe(true);
    const blank = await (await PDFDocument.create()).save();
    expect(await hasFormFields(blank)).toBe(false);
  });

  test('extractFormFields enumerates name, type, and options', async () => {
    const byName = Object.fromEntries(
      (await extractFormFields(await buildFixtureForm())).map((f) => [f.name, f])
    );
    expect(byName['applicant.name'].type).toBe('text');
    expect(byName['agree'].type).toBe('checkbox');
    expect(byName['status'].type).toBe('dropdown');
    expect(byName['status'].options).toEqual(['Pending', 'Approved', 'Rejected']);
    expect(byName['locked'].readOnly).toBe(true);
  });

  test('fillFormFields fills text/checkbox/dropdown and the values persist', async () => {
    const { bytes, filled, skipped } = await fillFormFields(await buildFixtureForm(), {
      'applicant.name': 'Jane Doe',
      agree: true,
      status: 'Approved',
    });
    expect(filled.sort()).toEqual(['agree', 'applicant.name', 'status']);
    expect(skipped).toEqual([]);

    // Re-read the produced PDF to confirm the values round-trip.
    const byName = Object.fromEntries((await extractFormFields(bytes)).map((f) => [f.name, f]));
    expect(byName['applicant.name'].value).toBe('Jane Doe');
    expect(byName['agree'].value).toBe(true);
    expect(byName['status'].value).toEqual(['Approved']);
  });

  test('fillFormFields skips unknown and read-only fields', async () => {
    const { filled, skipped } = await fillFormFields(await buildFixtureForm(), {
      nonexistent: 'x',
      locked: 'should not change',
      'applicant.name': 'OK',
    });
    expect(filled).toEqual(['applicant.name']);
    const reasons = Object.fromEntries(skipped.map((s) => [s.name, s.reason]));
    expect(reasons['nonexistent']).toMatch(/no such field/);
    expect(reasons['locked']).toMatch(/read-only/);
  });

  test('flatten produces a non-interactive PDF (no fillable fields after)', async () => {
    const { bytes } = await fillFormFields(
      await buildFixtureForm(),
      { 'applicant.name': 'Flat' },
      { flatten: true }
    );
    expect(await hasFormFields(bytes)).toBe(false);
  });
});

describe('pdf-forms layout + decode cache', () => {
  test('formFingerprint is deterministic and order-independent', () => {
    const a = formFingerprint([
      { name: 'x', type: 'text' },
      { name: 'y', type: 'checkbox' },
    ]);
    const b = formFingerprint([
      { name: 'y', type: 'checkbox' },
      { name: 'x', type: 'text' },
    ]);
    expect(a).toBe(b);
    expect(
      formFingerprint([
        { name: 'x', type: 'text' },
        { name: 'z', type: 'checkbox' },
      ])
    ).not.toBe(a);
  });

  test('extractFormLayout returns positioned fields in reading order', async () => {
    const layout = await extractFormLayout(await buildFixtureForm());
    expect(layout.every((f) => f.page === 1)).toBe(true);
    expect(layout.every((f) => f.rect && typeof f.rect.y === 'number')).toBe(true);
    const names = layout.map((f) => f.name);
    // The name field sits higher (y=320) than the checkbox (y=280) → reads first.
    expect(names.indexOf('applicant.name')).toBeLessThan(names.indexOf('agree'));
  });

  test('decodeForm caches the decode and reuses it without a second call', async () => {
    const pdf = await buildFixtureForm();
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'forms-'));
    const templatesPath = path.join(tmp, 'templates.json');
    let calls = 0;
    const decodeFn: DecodeFn = async (_bytes, layout) => {
      calls++;
      return {
        formName: 'Fixture',
        fields: layout.map((f) => ({ name: f.name, label: `meaning of ${f.name}`, key: 'k' })),
      };
    };

    const first = await decodeForm(pdf, { templatesPath, decodeFn });
    expect(first.cached).toBe(false);
    expect(calls).toBe(1);
    expect(first.fields.find((f) => f.name === 'applicant.name')?.label).toBe(
      'meaning of applicant.name'
    );

    const second = await decodeForm(pdf, { templatesPath, decodeFn });
    expect(second.cached).toBe(true);
    expect(calls).toBe(1); // cache hit — decodeFn not called again
    expect(second.formName).toBe('Fixture');

    await fs.rm(tmp, { recursive: true, force: true });
  });
});
