// Tests for the FHIR clinical-records parser. Uses fabricated fixtures that
// mirror the real Apple Health export shape — no personal data.

import { expect, test, describe } from 'vite-plus/test';
import { buildClinicalSummary, extractRefId } from './apple-health-clinical.js';

describe('extractRefId', () => {
  test('extracts trailing id from FHIR URL reference', () => {
    expect(extractRefId('https://api.example.com/services/fhir/v0/r4/Observation/abc-123')).toBe(
      'abc-123'
    );
  });

  test('returns null for missing/empty refs', () => {
    expect(extractRefId(undefined)).toBe(null);
    expect(extractRefId('')).toBe(null);
    expect(extractRefId('/')).toBe(null);
  });

  test('returns the whole string when there is no slash', () => {
    expect(extractRefId('bareId')).toBe(null);
  });
});

describe('buildClinicalSummary — lab Observation', () => {
  const obs = {
    resourceType: 'Observation' as const,
    id: 'obs-hdl-2024',
    status: 'final',
    category: [
      {
        text: 'Laboratory',
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/observation-category',
            code: 'laboratory',
          },
        ],
      },
    ],
    code: {
      text: 'HDL Cholesterol',
      coding: [{ system: 'http://loinc.org', code: '2085-9', display: 'HDL Cholesterol' }],
    },
    valueQuantity: { value: 62, unit: 'mg/dL' },
    referenceRange: [{ low: { value: 40, unit: 'mg/dL' }, high: { value: 100, unit: 'mg/dL' } }],
    effectiveDateTime: '2024-06-15T09:00:00Z',
  };

  test('extracts LOINC code as the trend key', () => {
    const summary = buildClinicalSummary([obs]);
    expect(summary.labsByTest).toHaveLength(1);
    expect(summary.labsByTest[0].loinc).toBe('2085-9');
  });

  test('captures value, unit, and reference range', () => {
    const summary = buildClinicalSummary([obs]);
    const trend = summary.labsByTest[0];
    expect(trend.latest?.value).toBe(62);
    expect(trend.unit).toBe('mg/dL');
    expect(trend.refLow).toBe(40);
    expect(trend.refHigh).toBe(100);
  });

  test('derives the in-range flag from value + range', () => {
    const summary = buildClinicalSummary([obs]);
    expect(summary.labsByTest[0].latestFlag).toBe('normal');
  });

  test('derives high flag when value exceeds refHigh', () => {
    const high = { ...obs, valueQuantity: { value: 150, unit: 'mg/dL' } };
    const summary = buildClinicalSummary([high]);
    expect(summary.labsByTest[0].latestFlag).toBe('high');
  });

  test('derives low flag when value is below refLow', () => {
    const low = { ...obs, valueQuantity: { value: 30, unit: 'mg/dL' } };
    const summary = buildClinicalSummary([low]);
    expect(summary.labsByTest[0].latestFlag).toBe('low');
  });

  test('provider-reported interpretation overrides derived flag', () => {
    const withH = {
      ...obs,
      valueQuantity: { value: 60, unit: 'mg/dL' },
      interpretation: [{ coding: [{ code: 'H' }] }],
    };
    const summary = buildClinicalSummary([withH]);
    expect(summary.labsByTest[0].latestFlag).toBe('high');
  });
});

describe('buildClinicalSummary — trending same LOINC across dates', () => {
  const mkObs = (id: string, date: string, value: number) => ({
    resourceType: 'Observation' as const,
    id,
    status: 'final',
    category: [{ coding: [{ code: 'laboratory' }] }],
    code: {
      text: 'HDL',
      coding: [{ system: 'http://loinc.org', code: '2085-9', display: 'HDL Cholesterol' }],
    },
    valueQuantity: { value, unit: 'mg/dL' },
    referenceRange: [{ low: { value: 40 }, high: { value: 100 } }],
    effectiveDateTime: date,
  });

  test('groups same-LOINC observations into one trend with points sorted oldest → newest', () => {
    const summary = buildClinicalSummary([
      mkObs('c', '2024-06-01T00:00:00Z', 58),
      mkObs('a', '2022-03-10T00:00:00Z', 45),
      mkObs('b', '2023-09-22T00:00:00Z', 52),
    ]);
    expect(summary.labsByTest).toHaveLength(1);
    const trend = summary.labsByTest[0];
    expect(trend.points.map((p) => p.id)).toEqual(['a', 'b', 'c']);
    expect(trend.latest?.id).toBe('c');
  });

  test('different LOINC codes produce separate trends', () => {
    const summary = buildClinicalSummary([
      mkObs('a', '2024-01-01', 50),
      {
        ...mkObs('b', '2024-01-01', 120),
        code: { coding: [{ system: 'http://loinc.org', code: '2093-3' }] },
      },
    ]);
    expect(summary.labsByTest).toHaveLength(2);
    const loincs = summary.labsByTest.map((t) => t.loinc).sort();
    expect(loincs).toEqual(['2085-9', '2093-3']);
  });

  test('falls back to display-name grouping when LOINC is missing', () => {
    const noCoding = {
      resourceType: 'Observation' as const,
      id: 'x',
      category: [{ coding: [{ code: 'laboratory' }] }],
      code: { text: 'Magic Test' },
      valueQuantity: { value: 5, unit: 'mg/dL' },
    };
    const summary = buildClinicalSummary([noCoding]);
    expect(summary.labsByTest).toHaveLength(1);
    expect(summary.labsByTest[0].loinc).toBe(null);
    expect(summary.labsByTest[0].name).toBe('Magic Test');
  });
});

describe('buildClinicalSummary — vital-signs routing', () => {
  test('vitals observations go to .vitals, not .labsByTest', () => {
    const vital = {
      resourceType: 'Observation' as const,
      id: 'bp',
      category: [{ coding: [{ code: 'vital-signs' }] }],
      code: {
        text: 'Blood Pressure Systolic',
        coding: [{ system: 'http://loinc.org', code: '8480-6' }],
      },
      valueQuantity: { value: 120, unit: 'mmHg' },
      effectiveDateTime: '2024-01-01T00:00:00Z',
    };
    const summary = buildClinicalSummary([vital]);
    expect(summary.vitals).toHaveLength(1);
    expect(summary.vitals[0].name).toBe('Blood Pressure Systolic');
    expect(summary.labsByTest).toHaveLength(0);
  });
});

describe('buildClinicalSummary — DiagnosticReport linking', () => {
  test('links observations to their panel via result[].reference', () => {
    const obs1 = {
      resourceType: 'Observation' as const,
      id: 'obs-1',
      category: [{ coding: [{ code: 'laboratory' }] }],
      code: { text: 'Test A' },
      valueQuantity: { value: 1 },
    };
    const obs2 = {
      resourceType: 'Observation' as const,
      id: 'obs-2',
      category: [{ coding: [{ code: 'laboratory' }] }],
      code: { text: 'Test B' },
      valueQuantity: { value: 2 },
    };
    const report = {
      resourceType: 'DiagnosticReport' as const,
      id: 'panel-1',
      code: { text: 'Metabolic Panel' },
      effectiveDateTime: '2024-01-01T00:00:00Z',
      result: [
        { reference: 'https://example.com/Observation/obs-1', display: 'Test A' },
        { reference: 'https://example.com/Observation/obs-2', display: 'Test B' },
      ],
    };
    const summary = buildClinicalSummary([obs1, obs2, report]);
    expect(summary.labPanels).toHaveLength(1);
    expect(summary.labPanels[0].resultIds).toEqual(['obs-1', 'obs-2']);
    // Each observation's panelId should now point back at the panel
    for (const trend of summary.labsByTest) {
      expect(trend.latest?.panelId).toBe('panel-1');
    }
  });
});

describe('buildClinicalSummary — non-observation resources', () => {
  test('normalizes Condition with ICD-10 code', () => {
    const c = {
      resourceType: 'Condition' as const,
      id: 'cond-1',
      code: {
        text: 'Hyperlipidemia',
        coding: [{ system: 'http://hl7.org/fhir/sid/icd-10-cm', code: 'E78.5' }],
      },
      clinicalStatus: { coding: [{ code: 'active' }] },
      onsetDateTime: '2023-05-01T00:00:00Z',
      recordedDate: '2023-05-01',
    };
    const summary = buildClinicalSummary([c]);
    expect(summary.conditions[0]).toMatchObject({
      name: 'Hyperlipidemia',
      icd10: 'E78.5',
      clinicalStatus: 'active',
      onsetDate: '2023-05-01',
    });
  });

  test('normalizes Immunization with CVX code', () => {
    const i = {
      resourceType: 'Immunization' as const,
      id: 'imm-1',
      vaccineCode: {
        text: 'MMR',
        coding: [{ system: 'http://hl7.org/fhir/sid/cvx', code: '03' }],
      },
      status: 'completed',
      occurrenceDateTime: '2008-07-17T00:00:00Z',
    };
    const summary = buildClinicalSummary([i]);
    expect(summary.immunizations[0]).toMatchObject({ name: 'MMR', cvx: '03', status: 'completed' });
  });

  test('normalizes AllergyIntolerance with reaction manifestations', () => {
    const a = {
      resourceType: 'AllergyIntolerance' as const,
      id: 'allergy-1',
      code: { text: 'Penicillins' },
      clinicalStatus: { coding: [{ code: 'active' }] },
      recordedDate: '2017-03-02',
      reaction: [{ manifestation: [{ text: 'Anaphylaxis' }, { text: 'Urticaria' }] }],
    };
    const summary = buildClinicalSummary([a]);
    expect(summary.allergies[0].reactions).toEqual(['Anaphylaxis', 'Urticaria']);
  });

  test('normalizes VA-style MedicationRequest (med name in contained[])', () => {
    // VA exports leave medicationCodeableConcept null and inline the actual
    // medication under contained[]. The drug name lives at contained[0].code.text.
    // The dosageInstruction.timing.code.text field — while syntactically valid
    // for a med name — actually carries frequency markers like "EVERY DAY", so
    // the parser must NOT fall back to it. Including a misleading timing.code
    // here locks in that negative invariant.
    const m = {
      resourceType: 'MedicationRequest' as const,
      id: 'med-1',
      status: 'active',
      authoredOn: '2024-02-27',
      medicationCodeableConcept: null,
      contained: [
        {
          resourceType: 'Medication',
          id: 'med-inline-1',
          code: { text: 'Lisinopril' },
        },
      ],
      dosageInstruction: [
        {
          text: '50MG',
          route: { text: 'MOUTH' },
          timing: { code: { text: 'EVERY DAY' } },
        },
      ],
    };
    const summary = buildClinicalSummary([m]);
    expect(summary.medications[0]).toMatchObject({
      name: 'Lisinopril',
      route: 'MOUTH',
      dosageText: '50MG',
    });
  });

  test('normalizes Procedure with CPT code', () => {
    const p = {
      resourceType: 'Procedure' as const,
      id: 'proc-1',
      code: {
        text: 'Urinalysis',
        coding: [{ system: 'http://www.ama-assn.org/go/cpt', code: '81003' }],
      },
      status: 'completed',
      performedDateTime: '2025-02-12T14:54:00Z',
    };
    const summary = buildClinicalSummary([p]);
    expect(summary.procedures[0]).toMatchObject({ name: 'Urinalysis', cpt: '81003' });
  });
});

describe('buildClinicalSummary — misc', () => {
  test('date range spans earliest → latest dated resource', () => {
    const obs1 = {
      resourceType: 'Observation' as const,
      id: 'a',
      category: [{ coding: [{ code: 'laboratory' }] }],
      code: { text: 'X' },
      valueQuantity: { value: 1 },
      effectiveDateTime: '2017-03-02T00:00:00Z',
    };
    const obs2 = {
      resourceType: 'Observation' as const,
      id: 'b',
      category: [{ coding: [{ code: 'laboratory' }] }],
      code: { text: 'X' },
      valueQuantity: { value: 2 },
      effectiveDateTime: '2025-12-16T00:00:00Z',
    };
    const summary = buildClinicalSummary([obs1, obs2]);
    expect(summary.dateRange.start).toBe('2017-03-02');
    expect(summary.dateRange.end).toBe('2025-12-16');
  });

  test('unknown resource types are skipped without crashing', () => {
    const summary = buildClinicalSummary([
      { resourceType: 'Patient', id: 'p1' },
      { resourceType: 'Encounter', id: 'e1' },
    ]);
    expect(summary.recordCount).toBe(2);
    expect(summary.conditions).toHaveLength(0);
    expect(summary.labsByTest).toHaveLength(0);
  });

  test('sorts out-of-range trends to the top', () => {
    const makeLab = (id: string, loinc: string, name: string, value: number, refHigh: number) => ({
      resourceType: 'Observation' as const,
      id,
      category: [{ coding: [{ code: 'laboratory' }] }],
      code: { text: name, coding: [{ system: 'http://loinc.org', code: loinc }] },
      valueQuantity: { value },
      referenceRange: [{ low: { value: 0 }, high: { value: refHigh } }],
      effectiveDateTime: '2025-01-01',
    });
    const summary = buildClinicalSummary([
      makeLab('a', '1', 'Normal Test', 5, 10),
      makeLab('b', '2', 'High Test', 200, 10),
    ]);
    expect(summary.labsByTest[0].name).toBe('High Test');
    expect(summary.labsByTest[0].latestFlag).toBe('high');
    expect(summary.labsByTest[1].name).toBe('Normal Test');
  });
});
