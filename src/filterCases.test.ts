import { describe, expect, it } from 'vitest';
import shared from '../shared/filter-cases.json' with { type: 'json' };
import { eligibleCandidates, type Conditions, type Session } from './domain';
import type { Category } from './data';

// The API server runs the same cases against its SQL filter (server/tests/test_filters_db.py).
describe('shared filter cases', () => {
  for (const k of shared.cases) it(k.name, () => {
    const session = { category: k.category as Category, raw: '', conditions: k.conditions as Conditions, excludedIds: k.excludedIds, revision: 0,
      ...(k.candidateIds ? { candidateScope: 'favorites' as const, candidateIds: k.candidateIds } : {}) } satisfies Session;
    expect(eligibleCandidates(session, { selected: [], tags: [], disliked: k.disliked }).map(i => i.id).sort()).toEqual(k.expectedIds);
  });
});
