import { emptyConditions, type Profile, type Session } from './domain';
import { defaultView, type View } from './navigation';
const KEY = 'nowrecommend-session-v1';
export type TabState = { version: 1; view: View; session: Session; active: boolean; draftProfile?: Profile; editingProfile?: boolean; onboardSummary?: boolean; query?: string; selectedOnly?: boolean };
export function newSession(category: 'food' | 'music' = 'food'): Session {
  return { category, raw: '', conditions: emptyConditions(), excludedIds: [], revision: 0 };
}
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string');
export function validConditions(v: any): boolean {
  return !!v && strings(v.tags) && strings(v.excluded) && (v.maxPrice === null || Number.isFinite(v.maxPrice) && v.maxPrice >= 100 && v.maxPrice <= 1000000);
}
function profile(v: any): boolean { return !!v && strings(v.selected) && strings(v.tags) && strings(v.disliked); }
export function readTab(): TabState {
  try {
    const text = sessionStorage.getItem(KEY);
    if (text && text.length <= 2000000) {
      const v = JSON.parse(text), s = v?.session, e = s?.editor;
      if (v.version === 1 && typeof v.active === 'boolean' && ['food','music'].includes(s?.category) && typeof s.raw === 'string' && s.raw.length <= 300 && validConditions(s.conditions) && strings(s.excludedIds) && Number.isInteger(s.revision) && s.revision >= 0
        && ['home','recommend','onboard','favorites','history','taste','login','complete'].includes(v.view?.page) && ['food','music'].includes(v.view?.category) && ['input','confirm','results'].includes(v.view?.step)
        && (!e || typeof e.parsedRaw === 'string' && validConditions(e.automatic) && validConditions(e.manual) && strings(e.removedTags) && strings(e.removedExcluded) && (e.budgetInput === undefined || typeof e.budgetInput === 'string'))
        && (!v.draftProfile || profile(v.draftProfile))) return v;
    }
  } catch { /* A tab storage failure must not prevent startup. */ }
  return { version: 1, view: defaultView, session: newSession(), active: false };
}
export function writeTab(state: TabState): boolean {
  try { sessionStorage.setItem(KEY, JSON.stringify(state)); return true; } catch { return false; }
}
