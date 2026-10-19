import { describe, expect, it } from 'vitest';
import seed from '../server/data/seed_items.json' with { type: 'json' };
import { seedFile } from '../scripts/catalog-seed';

describe('server seed catalog', () => {
  it('matches the bundled catalog (run scripts/export-catalog.ts after editing data.ts)', () => {
    expect(seed).toEqual(seedFile());
  });
});
