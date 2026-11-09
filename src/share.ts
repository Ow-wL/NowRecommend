import type { Item } from './data';
import type { Conditions } from './domain';

/** What leaves the app when the person shares: the request's name, the items by name, the conditions, and the public address.
 * No account, no history id, no hash state. */
export type ShareInput = { title: string; items: Pick<Item, 'name' | 'subtitle' | 'category'>[]; conditions?: string[] };
export const conditionLabels = (c: Conditions) => [...c.tags, ...c.excluded.map(t => `${t} 제외`)];
export function shareText({ title, items, conditions = [] }: ShareInput): string {
  const lines = [`지금 추천 · ${title}`, ...items.map((item, n) => `${items.length > 1 ? `${n + 1}. ` : ''}${item.name}${item.category === 'music' ? ` – ${item.subtitle}` : ''}`)];
  if (conditions.length) lines.push(`조건: ${conditions.join(' · ')}`);
  return lines.join('\n');
}
export const appAddress = () => `${location.origin}${location.pathname}`;
export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'failed';
/** The system share sheet where there is one; otherwise the text goes to the clipboard. */
export async function shareResults(input: ShareInput): Promise<ShareOutcome> {
  const text = shareText(input), url = appAddress();
  if (typeof navigator.share === 'function') {
    try { await navigator.share({ title: '지금 추천', text, url }); return 'shared'; }
    catch (error) { if ((error as Error).name === 'AbortError') return 'cancelled'; }
  }
  try { await navigator.clipboard.writeText(`${text}\n${url}`); return 'copied'; } catch { return 'failed'; }
}
