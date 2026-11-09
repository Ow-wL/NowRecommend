import { describe, expect, it } from 'vitest';
import { items } from './data';
import { emptyProfile, type Preset } from './domain';
import { describePair, pairRequest, recommendPairs, recordPair, replaceSong, withSeen } from './pairing';

const moment = { food: { id: 'a', category: 'food', name: '따뜻한 저녁', conditions: { tags: ['저녁', '따뜻함'], excluded: [] } }, music: { id: 'b', category: 'music', name: '차분한 저녁', conditions: { tags: ['휴식', '차분함'], excluded: [] } } } as Record<'food' | 'music', Preset>;
const profiles = { food: emptyProfile(), music: emptyProfile() };
const dish = (tags: string[]) => ({ ...items.find(i => i.category === 'food')!, tags });
const track = (tags: string[]) => ({ ...items.find(i => i.category === 'music')!, tags });

describe('food and music pairs', () => {
  it('follows the hour when nothing is written, and names it', () => {
    const request = pairRequest('  ', moment);
    expect(request.label).toBe('따뜻한 저녁');
    expect(request.typed).toEqual({ food: false, music: false });
    expect(request.conditions.music.tags).toEqual(['휴식', '차분함']);
  });

  it('gives each dish its own song and never the same artist twice', () => {
    const pairs = recommendPairs(pairRequest('', moment), profiles, items);
    expect(pairs).toHaveLength(3);
    expect(new Set(pairs.map(p => p.food.id)).size).toBe(3);
    expect(new Set(pairs.map(p => p.song.id)).size).toBe(3);
    expect(new Set(pairs.map(p => p.song.subtitle)).size).toBe(3);
  });

  it('names only tags both items really carry', () => {
    for (const pair of recommendPairs(pairRequest('', moment), profiles, items))
      for (const link of pair.links) { expect(pair.food.tags).toContain(link.food); expect(pair.song.tags).toContain(link.music); }
  });

  it('explains a spicy dish by the song it was matched to', () => {
    const pair = describePair(dish(['매콤함']), track(['활기참']), pairRequest('', moment));
    expect(pair.links).toEqual([{ food: '매콤함', music: '활기참' }]);
    expect(pair.reason).toBe(`매콤한 ${pair.food.name}에 활기찬 곡을 맞췄어요.`);
  });

  it('reads differently for two pairs built on the same traits', () => {
    const reasons = recommendPairs(pairRequest('', moment), profiles, items).map(p => p.reason);
    expect(new Set(reasons).size).toBe(reasons.length);
  });

  it('says so when a pair has nothing in common', () => {
    const pair = describePair(dish(['매콤함']), track(['보컬']), pairRequest('', moment));
    expect(pair.links).toEqual([]);
    expect(pair.reason).toBe('이 메뉴와 맞물리는 특징은 적은 곡이에요.');
  });

  it('lets written music words outrank what the dish would suggest', () => {
    const request = pairRequest('매콤한 거 먹으면서 잔잔한 노래', moment);
    expect(request.typed.music).toBe(true);
    const wanted = request.conditions.music.tags;
    expect(wanted.length).toBeGreaterThan(0);
    for (const pair of recommendPairs(request, profiles, items)) {
      expect(pair.song.tags.some(t => wanted.includes(t))).toBe(true);
      expect(pair.reason).toMatch(/^이번 조건 /);
    }
  });

  it('keeps long-term dislikes out on both sides', () => {
    const first = recommendPairs(pairRequest('', moment), profiles, items)[0];
    const pairs = recommendPairs(pairRequest('', moment), { food: { ...emptyProfile(), disliked: [first.food.id] }, music: { ...emptyProfile(), disliked: [first.song.id] } }, items);
    expect(pairs.map(p => p.food.id)).not.toContain(first.food.id);
    expect(pairs.map(p => p.song.id)).not.toContain(first.song.id);
  });

  it('shows new dishes and songs on the next set', () => {
    const request = pairRequest('', moment);
    const first = recommendPairs(request, profiles, items);
    const next = recommendPairs(request, profiles, items, withSeen({ food: [], music: [] }, first));
    expect(next.map(p => p.food.id).filter(id => first.some(p => p.food.id === id))).toEqual([]);
    expect(next.map(p => p.song.id).filter(id => first.some(p => p.song.id === id))).toEqual([]);
  });

  it('swaps one song without touching the others', () => {
    const request = pairRequest('', moment);
    const pairs = recommendPairs(request, profiles, items);
    const next = replaceSong(pairs[0], pairs, request, profiles, items, withSeen({ food: [], music: [] }, pairs))!;
    expect(next.food.id).toBe(pairs[0].food.id);
    expect(pairs.map(p => p.song.id)).not.toContain(next.song.id);
    expect(pairs.slice(1).map(p => p.song.subtitle)).not.toContain(next.song.subtitle);
  });

  it('runs out honestly instead of repeating a song', () => {
    const request = pairRequest('', moment);
    const pairs = recommendPairs(request, profiles, items);
    const everything = { food: [], music: items.filter(i => i.category === 'music').map(i => i.id) };
    expect(replaceSong(pairs[0], pairs, request, profiles, items, everything)).toBeNull();
  });

  it('records the dish and the song as two chosen entries', () => {
    const request = pairRequest('', moment);
    const [pair] = recommendPairs(request, profiles, items);
    const { history, ids } = recordPair([], request, pair, profiles, items);
    expect(ids).toHaveLength(2);
    expect(history.map(h => h.category).sort()).toEqual(['food', 'music']);
    expect(history.every(h => h.raw === '따뜻한 저녁' && !!h.selected)).toBe(true);
    expect(history.find(h => h.category === 'music')!.selected!.result.contextReason).toBe(pair.reason);
  });
});
