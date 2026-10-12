import { afterEach, expect, it, vi } from 'vitest';
import { defaultView } from './navigation';
import { newSession, readTab, writeTab, type TabState } from './sessionStorage';
afterEach(() => vi.unstubAllGlobals());
it('roundtrips the active request including temporary exclusions', () => {
  let saved: string | null = null;
  vi.stubGlobal('sessionStorage', { getItem: () => saved, setItem: (_: string, text: string) => { saved = text; } });
  const state: TabState = { version: 1, active: true, view: { ...defaultView, page: 'recommend', step: 'results' }, session: { ...newSession(), raw: '담백한 저녁', excludedIds: ['f01'] } };
  expect(writeTab(state)).toBe(true); expect(readTab()).toEqual(state);
});
it('handles malformed tab data and refused writes without crashing', () => {
  vi.stubGlobal('sessionStorage', { getItem: () => '{broken', setItem: () => { throw new Error('blocked'); } });
  expect(readTab().active).toBe(false);
  expect(writeTab({version:1,active:false,view:defaultView,session:newSession()})).toBe(false);
});
