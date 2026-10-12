import type { Category } from './data';
export type Page = 'home' | 'recommend' | 'onboard' | 'favorites' | 'history' | 'taste' | 'login' | 'complete';
export type Step = 'input' | 'confirm' | 'results';
export type View = { page: Page; category: Category; step: Step };
export const defaultView: View = { page: 'home', category: 'food', step: 'input' };
export function viewReducer(state: View, patch: Partial<View>): View { return { ...state, ...patch }; }
export function routeFor(view: View): string {
  return ['recommend','onboard'].includes(view.page) ? `#/${view.page}/${view.category}/${view.step}` : `#/${view.page}`;
}
export function parseRoute(hash: string): View {
  const match = hash.match(/^#\/(recommend|onboard)\/(food|music)(?:\/(input|confirm|results))?$/);
  if (match) return { page: match[1] as Page, category: match[2] as Category, step: (match[3] || 'input') as Step };
  const page = hash.slice(2);
  return ['home','favorites','history','taste','login','complete'].includes(page) ? { ...defaultView, page: page as Page } : defaultView;
}
