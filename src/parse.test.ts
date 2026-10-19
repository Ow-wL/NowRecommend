import { afterEach, describe, expect, it, vi } from 'vitest';
import { validRemoteParse } from './api/parse';
import { applyParsed, changeText, toggleCondition, type Session } from './domain';
import { defaultView } from './navigation';
import { newSession, readTab, writeTab } from './sessionStorage';

const typed = (raw: string): Session => changeText({ ...newSession('food') }, raw);
const server = { tags: ['담백함', '따뜻함'], excluded: ['매콤함'], maxPrice: null };
afterEach(() => vi.unstubAllGlobals());

describe('applyParsed', () => {
  it('replaces the automatic conditions of the same sentence', () => {
    const s = applyParsed(typed('속이 안 좋아서 부담 없는 걸로'), '속이 안 좋아서 부담 없는 걸로', server, { raw: '속이 안 좋아서 부담 없는 걸로', source: 'rule+ai', unparsed: [] });
    expect(s.conditions).toEqual(server);
    expect(s.editor?.ai?.source).toBe('rule+ai');
  });
  it('ignores answers for a sentence that has since changed', () => {
    const current = typed('담백한 저녁');
    expect(applyParsed(current, '이전 문장', server, { raw: '이전 문장', source: 'rule+ai', unparsed: [] })).toBe(current);
  });
  it('keeps manual choices and conditions the user removed', () => {
    let s = typed('담백한 저녁');
    s = toggleCondition(s, '국물');           // manual add
    s = toggleCondition(s, '저녁');           // remove an automatic tag
    s = applyParsed(s, '담백한 저녁', { tags: ['담백함', '저녁', '따뜻함'], excluded: [], maxPrice: null }, { raw: '담백한 저녁', source: 'rule+ai', unparsed: [] });
    expect(s.conditions.tags).toEqual(['담백함', '따뜻함', '국물']);
  });
  it('records a local fallback without touching conditions', () => {
    const before = typed('3만원으로 기념일 저녁');
    const after = applyParsed(before, '3만원으로 기념일 저녁', null, { raw: '3만원으로 기념일 저녁', source: 'local', unparsed: [] });
    expect(after.conditions).toEqual(before.conditions);
    expect(after.editor?.ai?.source).toBe('local');
  });
});

describe('parse response and tab storage', () => {
  it('validates the server answer', () => {
    const ok = { conditions: server, unparsed: ['기념일'], source: 'rule+ai', ai: 'used' };
    expect(validRemoteParse(ok)).toBe(true);
    expect(validRemoteParse({ ...ok, source: 'magic' })).toBe(false);
    expect(validRemoteParse({ ...ok, conditions: { ...server, maxPrice: 5 } })).toBe(false);
    expect(validRemoteParse({ ...ok, unparsed: [3] })).toBe(false);
  });
  it('restores the interpretation after a reload', () => {
    let saved: string | null = null;
    vi.stubGlobal('sessionStorage', { getItem: () => saved, setItem: (_: string, text: string) => { saved = text; } });
    const session = applyParsed(typed('기념일 저녁'), '기념일 저녁', server, { raw: '기념일 저녁', source: 'rule+ai', unparsed: ['기념일'] });
    writeTab({ version: 1, active: true, view: { ...defaultView, page: 'recommend', step: 'input' }, session });
    expect(readTab().session.editor?.ai).toEqual({ raw: '기념일 저녁', source: 'rule+ai', unparsed: ['기념일'] });
  });
  it('opens a tab saved on the old confirm step on the merged input screen', () => {
    let saved: string | null = null;
    vi.stubGlobal('sessionStorage', { getItem: () => saved, setItem: (_: string, text: string) => { saved = text; } });
    writeTab({ version: 1, active: true, view: { ...defaultView, page: 'recommend', step: 'input' }, session: typed('기념일 저녁') });
    saved = saved!.replace('"step":"input"', '"step":"confirm"');
    expect(readTab().view.step).toBe('input');
  });
});
