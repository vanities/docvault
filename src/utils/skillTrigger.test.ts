// Pure-logic tests for the $skill composer trigger — synthetic strings only.

import { describe, expect, test } from 'vite-plus/test';
import {
  detectSkillTrigger,
  filterSkills,
  insertSkillMention,
  splitSkillTokens,
} from './skillTrigger';

describe('detectSkillTrigger', () => {
  test('triggers on a bare $ at start and mid-text', () => {
    expect(detectSkillTrigger('$', 1)).toEqual({ query: '', start: 0, end: 1 });
    expect(detectSkillTrigger('check $tax', 10)).toEqual({ query: 'tax', start: 6, end: 10 });
  });

  test('caret position bounds the query', () => {
    // caret right after the $ even though more text follows
    expect(detectSkillTrigger('$tax-review please', 4)).toEqual({
      query: 'tax',
      start: 0,
      end: 4,
    });
  });

  test('does not trigger mid-word or without $', () => {
    expect(detectSkillTrigger('costs$5', 7)).toBeNull();
    expect(detectSkillTrigger('plain text', 5)).toBeNull();
    expect(detectSkillTrigger('', 0)).toBeNull();
  });

  test('does not trigger once a space ends the token', () => {
    expect(detectSkillTrigger('$tax done', 9)).toBeNull();
  });
});

describe('filterSkills', () => {
  const skills = [
    { name: 'doc-review', description: 'Review a document for issues' },
    { name: 'monthly-report', description: 'Draft the monthly revenue summary' },
    { name: 'review-budget', description: 'Check spending against plan' },
  ];

  test('empty query returns everything', () => {
    expect(filterSkills(skills, '').length).toBe(3);
  });

  test('prefix beats substring beats description', () => {
    const names = filterSkills(skills, 'rev').map((s) => s.name);
    expect(names).toEqual(['review-budget', 'doc-review', 'monthly-report']);
  });

  test('no match returns empty', () => {
    expect(filterSkills(skills, 'zzz')).toEqual([]);
  });
});

describe('insertSkillMention', () => {
  test('replaces the in-progress token and appends a space', () => {
    const trigger = detectSkillTrigger('use $doc now', 8)!;
    const result = insertSkillMention('use $doc now', trigger, 'doc-review');
    expect(result.text).toBe('use $doc-review  now');
    expect(result.cursor).toBe('use $doc-review '.length);
  });
});

describe('splitSkillTokens', () => {
  const known = ['doc-review', 'monthly-report'];

  test('chips known mentions, leaves unknown $tokens and prices alone', () => {
    expect(splitSkillTokens('run $doc-review on this $400 receipt $nope', known)).toEqual([
      { type: 'text', text: 'run ' },
      { type: 'skill', name: 'doc-review' },
      { type: 'text', text: ' on this $400 receipt $nope' },
    ]);
  });

  test('mention followed by punctuation still chips', () => {
    expect(splitSkillTokens('use $doc-review, please', known)).toEqual([
      { type: 'text', text: 'use ' },
      { type: 'skill', name: 'doc-review' },
      { type: 'text', text: ', please' },
    ]);
  });

  test('plain text and empty known list pass through', () => {
    expect(splitSkillTokens('nothing here', known)).toEqual([
      { type: 'text', text: 'nothing here' },
    ]);
    expect(splitSkillTokens('$doc-review', [])).toEqual([{ type: 'text', text: '$doc-review' }]);
  });
});
