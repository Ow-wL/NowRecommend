import { CATALOG_META, items, type Item } from '../src/data';

// Shape of server/data/seed_items.json, the DB seed for the API server (plans-rag.md R1).
export type SeedItem = {
  id: string; category: Item['category']; name: string; artist: string | null; subtitle: string; description: string;
  tags: string[]; ingredients: string[]; emoji: string; color: string;
};

export function toSeedItems(catalog: Item[] = items): SeedItem[] {
  return catalog.map(i => ({
    id: i.id, category: i.category, name: i.name, artist: i.category === 'music' ? i.subtitle : null, subtitle: i.subtitle,
    description: i.description, tags: [...i.tags], ingredients: [...i.ingredients],
    emoji: i.emoji, color: i.color,
  }));
}

export const seedFile = () => ({ source: CATALOG_META.version, items: toSeedItems() });
