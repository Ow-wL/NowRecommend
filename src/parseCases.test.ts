import { describe, expect, it } from 'vitest';
import shared from '../shared/parse-cases.json' with { type: 'json' };
import { parseConditions, unsupportedConditions } from './domain';
import type { Category } from './data';

// The API server's rule parser runs the same cases (server/tests/test_parsing.py).
describe('shared parse cases', () => {
  for (const k of shared.cases) it(`${k.category}: ${k.text || '(빈 문장)'}`, () => {
    const { unsupported, ...conditions } = k.expected;
    expect(parseConditions(k.text, k.category as Category)).toEqual(conditions);
    expect(unsupportedConditions(k.text, k.category as Category)).toEqual(unsupported);
  });
});
