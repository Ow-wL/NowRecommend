import { emptyConditions, type Profile, type Session } from './domain';
import { validItem } from './catalog';
import { defaultView, type View } from './navigation';
const KEY = 'nowrecommend-session-v1';
export type TabState = { version: 1; view: View; session: Session; active: boolean; draftProfile?: Profile; editingProfile?: boolean; onboardSummary?: boolean; query?: string; selectedOnly?: boolean; completedId?: string };
export function newSession(category: 'food' | 'music' = 'food'): Session {
  return { id: crypto.randomUUID(), category, raw: '', conditions: emptyConditions(), excludedIds: [], revision: 0 };
}
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string');
export function validConditions(v: any): boolean {
  return !!v && strings(v.tags) && strings(v.excluded) && (v.maxPrice === null || Number.isFinite(v.maxPrice) && v.maxPrice >= 100 && v.maxPrice <= 1000000);
}
export function validRecommendation(v: any): boolean {
  return validItem(v?.item) && typeof v.tasteReason === 'string' && typeof v.contextReason === 'string';
}
function profile(v: any): boolean { return !!v && strings(v.selected) && strings(v.tags) && strings(v.disliked); }
export function readTab(): TabState {
  try {
    const text = sessionStorage.getItem(KEY);
    if (text && text.length <= 2000000) {
      const v = JSON.parse(text), s = v?.session, e = s?.editor;
      if (v.version === 1 && typeof v.active === 'boolean' && ['food','music'].includes(s?.category) && typeof s.raw === 'string' && s.raw.length <= 300 && validConditions(s.conditions) && strings(s.excludedIds) && Number.isInteger(s.revision) && s.revision >= 0
        && ['home','recommend','onboard','favorites','history','taste','login','complete'].includes(v.view?.page) && ['food','music'].includes(v.view?.category) && ['input','confirm','results'].includes(v.view?.step)
        && (!e || typeof e.parsedRaw === 'string' && validConditions(e.automatic) && validConditions(e.manual) && strings(e.removedTags) && strings(e.removedExcluded) && (e.budgetInput === undefined || typeof e.budgetInput === 'string') && (e.ai === undefined || typeof e.ai.raw === 'string' && ['rule','rule+ai','local'].includes(e.ai.source) && strings(e.ai.unparsed)))
        && (s.pinnedIds===undefined || strings(s.pinnedIds) && s.pinnedIds.length<=(s.category==='food'?3:5)) && (s.compareIds===undefined || strings(s.compareIds) && s.compareIds.length<=3) && (s.candidateScope === undefined || s.candidateScope === 'favorites' && strings(s.candidateIds)) && (s.source === undefined || ['server','local'].includes(s.source)) && (s.quality === undefined || ['used','failed','off'].includes(s.quality.ai) && typeof s.quality.context === 'boolean') && (!v.draftProfile || profile(v.draftProfile)) && (!s.seenIds || strings(s.seenIds)) && (!s.currentIds || strings(s.currentIds)) && (s.batchNewCount === undefined || Number.isInteger(s.batchNewCount) && s.batchNewCount >= 0) && (s.id === undefined || typeof s.id === 'string') && (s.roundId === undefined || typeof s.roundId === 'string') && (s.snapshot === undefined || Array.isArray(s.snapshot) && s.snapshot.every(validRecommendation)) && (v.completedId === undefined || typeof v.completedId === 'string')) return v.view.step === 'confirm' ? { ...v, view: { ...v.view, step: 'input' } } : v; // confirm merged into input
    }
  } catch { /* A tab storage failure must not prevent startup. */ }
  return { version: 1, view: defaultView, session: newSession(), active: false };
}
export function writeTab(state: TabState): boolean {
  try { sessionStorage.setItem(KEY, JSON.stringify(state)); return true; } catch { return false; }
}
