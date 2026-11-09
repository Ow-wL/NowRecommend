import type { Category } from './data';
export type Page = 'home' | 'recommend' | 'onboard' | 'favorites' | 'history' | 'taste' | 'login' | 'complete' | 'lab' | 'type' | 'admin';
export type Step = 'input' | 'results';
export type View = { page: Page; category: Category; step: Step };
export const defaultView: View = { page: 'home', category: 'food', step: 'input' };
export function viewReducer(state: View, patch: Partial<View>): View { return { ...state, ...patch }; }
export function routeFor(view: View): string {
  return ['recommend','onboard'].includes(view.page) ? `#/${view.page}/${view.category}/${view.step}` : `#/${view.page}`;
}
export function parseRoute(hash: string): View {
  const match = hash.match(/^#\/(recommend|onboard)\/(food|music)(?:\/(input|confirm|results))?$/);
  if (match) return { page: match[1] as Page, category: match[2] as Category, step: match[3] === 'results' ? 'results' : 'input' };
  const page = hash.slice(2);
  return ['home','favorites','history','taste','login','complete','lab','type','admin'].includes(page) ? { ...defaultView, page: page as Page } : defaultView;
}
export type Direction = 'forward' | 'back';
/** How deep a screen sits: home, then the menu-level screens, then what opens from them, then the completion. */
const depth = (v: View): number => v.page === 'home' ? 0 : v.page === 'complete' ? 3 : ['onboard', 'type', 'admin'].includes(v.page) || (v.page === 'recommend' && v.step === 'results') ? 2 : 1;
/** Left-to-right order of screens at one depth: the menu order, food before music. */
const lateral = (v: View): number => ['home', 'recommend', 'onboard', 'favorites', 'history', 'taste', 'admin', 'login', 'lab', 'type'].indexOf(v.page) * 2 + (['recommend', 'onboard'].includes(v.page) && v.category === 'music' ? 1 : 0);
/** Which way a move reads: deeper or to the right in the menu is forward, back up or to the left is back. */
export function navigationDirection(from: View, to: View): Direction {
  const a = depth(from), b = depth(to);
  if (a !== b) return b > a ? 'forward' : 'back';
  return lateral(to) >= lateral(from) ? 'forward' : 'back';
}
