import { expect, test, describe } from 'vite-plus/test';
import {
  isBusinessDocumentType,
  getBusinessSubfolder,
  EXPENSE_CATEGORIES,
  EXPENSE_FOLDER_MAP,
  DOCUMENT_TYPES,
  TAX_YEAR_STRUCTURE,
  BUSINESS_FOLDER_STRUCTURE,
} from './config';

describe('isBusinessDocumentType', () => {
  test('returns true for business doc types', () => {
    expect(isBusinessDocumentType('formation')).toBe(true);
    expect(isBusinessDocumentType('ein-letter')).toBe(true);
    expect(isBusinessDocumentType('license')).toBe(true);
    expect(isBusinessDocumentType('business-agreement')).toBe(true);
    expect(isBusinessDocumentType('operating-agreement')).toBe(true);
    expect(isBusinessDocumentType('insurance-policy')).toBe(true);
  });

  test('returns false for non-business doc types', () => {
    expect(isBusinessDocumentType('w2')).toBe(false);
    expect(isBusinessDocumentType('1099-nec')).toBe(false);
    expect(isBusinessDocumentType('receipt')).toBe(false);
    expect(isBusinessDocumentType('invoice')).toBe(false);
    expect(isBusinessDocumentType('other')).toBe(false);
    expect(isBusinessDocumentType('bank-statement')).toBe(false);
    expect(isBusinessDocumentType('return')).toBe(false);
  });
});

describe('getBusinessSubfolder', () => {
  test('maps formation docs to formation folder', () => {
    expect(getBusinessSubfolder('formation')).toBe('formation');
  });

  test('maps business-agreement to contracts folder', () => {
    expect(getBusinessSubfolder('business-agreement')).toBe('contracts');
  });

  test('maps contract to contracts folder', () => {
    expect(getBusinessSubfolder('contract')).toBe('contracts');
  });

  test('maps ein-letter to ein folder', () => {
    expect(getBusinessSubfolder('ein-letter')).toBe('ein');
  });

  test('maps license to licenses folder', () => {
    expect(getBusinessSubfolder('license')).toBe('licenses');
  });

  test('maps operating-agreement to agreements folder', () => {
    expect(getBusinessSubfolder('operating-agreement')).toBe('agreements');
  });

  test('maps insurance-policy to insurance folder', () => {
    expect(getBusinessSubfolder('insurance-policy')).toBe('insurance');
  });

  test('returns "other" for unmapped types', () => {
    expect(getBusinessSubfolder('w2')).toBe('other');
    expect(getBusinessSubfolder('receipt')).toBe('other');
  });
});

describe('EXPENSE_CATEGORIES configuration', () => {
  test('meals has 50% deduction rate', () => {
    const meals = EXPENSE_CATEGORIES.find((c) => c.id === 'meals');
    expect(meals).toBeDefined();
    expect(meals!.deductionRate).toBe(0.5);
  });

  test('home-improvement has 0% deduction rate', () => {
    const homeImprovement = EXPENSE_CATEGORIES.find((c) => c.id === 'home-improvement');
    expect(homeImprovement).toBeDefined();
    expect(homeImprovement!.deductionRate).toBe(0);
  });

  test('software has 100% deduction rate', () => {
    const software = EXPENSE_CATEGORIES.find((c) => c.id === 'software');
    expect(software).toBeDefined();
    expect(software!.deductionRate).toBe(1);
  });

  test('every category has a deduction rate defined', () => {
    for (const cat of EXPENSE_CATEGORIES) {
      expect(typeof cat.deductionRate).toBe('number');
      expect(cat.deductionRate).toBeGreaterThanOrEqual(0);
      expect(cat.deductionRate).toBeLessThanOrEqual(1);
    }
  });

  test('all categories have a folder mapping', () => {
    for (const cat of EXPENSE_CATEGORIES) {
      expect(cat.folder).toBeDefined();
    }
  });
});

describe('EXPENSE_FOLDER_MAP', () => {
  test('childcare maps to expenses/childcare', () => {
    expect(EXPENSE_FOLDER_MAP.childcare).toBe('expenses/childcare');
  });

  test('medical maps to expenses/medical', () => {
    expect(EXPENSE_FOLDER_MAP.medical).toBe('expenses/medical');
  });

  test('home-improvement maps to expenses/home-improvement', () => {
    expect(EXPENSE_FOLDER_MAP['home-improvement']).toBe('expenses/home-improvement');
  });

  test('business expense categories map to expenses/business', () => {
    expect(EXPENSE_FOLDER_MAP.meals).toBe('expenses/business');
    expect(EXPENSE_FOLDER_MAP.software).toBe('expenses/business');
    expect(EXPENSE_FOLDER_MAP.equipment).toBe('expenses/business');
    expect(EXPENSE_FOLDER_MAP.travel).toBe('expenses/business');
    expect(EXPENSE_FOLDER_MAP.other).toBe('expenses/business');
  });

  test('every ExpenseCategory in config has a folder map entry', () => {
    for (const cat of EXPENSE_CATEGORIES) {
      expect(EXPENSE_FOLDER_MAP[cat.id]).toBeDefined();
    }
  });
});

describe('DOCUMENT_TYPES configuration', () => {
  test('contains all expected income types', () => {
    const incomeTypes = DOCUMENT_TYPES.filter((d) => d.category === 'income').map((d) => d.id);
    expect(incomeTypes).toContain('w2');
    expect(incomeTypes).toContain('1099-nec');
    expect(incomeTypes).toContain('invoice');
    expect(incomeTypes).toContain('k-1');
  });

  test('contains expense type', () => {
    const expenseTypes = DOCUMENT_TYPES.filter((d) => d.category === 'expense').map((d) => d.id);
    expect(expenseTypes).toContain('receipt');
  });

  test('contains business types', () => {
    const bizTypes = DOCUMENT_TYPES.filter((d) => d.category === 'business').map((d) => d.id);
    expect(bizTypes).toContain('formation');
    expect(bizTypes).toContain('ein-letter');
    expect(bizTypes).toContain('operating-agreement');
  });

  test('every type has a label', () => {
    for (const dt of DOCUMENT_TYPES) {
      expect(dt.label.length).toBeGreaterThan(0);
    }
  });
});

describe('TAX_YEAR_STRUCTURE', () => {
  test('w2 folder exists', () => {
    expect(TAX_YEAR_STRUCTURE['income/w2']).toContain('w2');
  });

  test('1099 folder contains all 1099 variants', () => {
    const variants = TAX_YEAR_STRUCTURE['income/1099'];
    expect(variants).toContain('1099-nec');
    expect(variants).toContain('1099-composite');
    expect(variants).toContain('1099-b');
  });

  test('expenses folders exist', () => {
    expect(TAX_YEAR_STRUCTURE['expenses/business']).toBeDefined();
    expect(TAX_YEAR_STRUCTURE['expenses/childcare']).toBeDefined();
    expect(TAX_YEAR_STRUCTURE['expenses/medical']).toBeDefined();
  });
});

describe('BUSINESS_FOLDER_STRUCTURE', () => {
  test('formation folder exists', () => {
    expect(BUSINESS_FOLDER_STRUCTURE.formation).toContain('formation');
  });

  test('contracts folder includes business-agreement and contract', () => {
    expect(BUSINESS_FOLDER_STRUCTURE.contracts).toContain('business-agreement');
    expect(BUSINESS_FOLDER_STRUCTURE.contracts).toContain('contract');
  });
});
