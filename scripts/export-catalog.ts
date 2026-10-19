// Regenerates server/data/seed_items.json from src/data.ts: npx vite-node scripts/export-catalog.ts
import { writeFileSync } from 'node:fs';
import { seedFile } from './catalog-seed';

const target = new URL('../server/data/seed_items.json', import.meta.url);
writeFileSync(target, JSON.stringify(seedFile(), null, 2) + '\n', 'utf8');
console.log(`wrote ${seedFile().items.length} items to server/data/seed_items.json`);
