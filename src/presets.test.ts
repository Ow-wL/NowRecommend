import { describe,it,expect } from 'vitest';
import { applyPreset, defaultPresets, validPreset } from './presets';
import { newSession } from './sessionStorage';
import { changeText } from './domain';
import { decodeStore } from './storage';
import { emptyStore } from './domain';
describe('condition presets',()=>{
  it('built-ins contain valid conditions for their independent category',()=>{expect(defaultPresets.every(validPreset)).toBe(true);expect(validPreset({...defaultPresets[0],category:'music'})).toBe(false);});
  it('overwrites the text but never imports exposure or exclusion ids',()=>{
    const session={...changeText(newSession(),'매운 점심'),excludedIds:['f01'],seenIds:['f02']};
    const applied=applyPreset(session,defaultPresets[0].conditions);
    expect(applied.raw).toBe('');expect(applied.conditions).toEqual(defaultPresets[0].conditions);expect(applied.excludedIds).toEqual(['f01']);expect(applied.seenIds).toEqual(['f02']);
  });
  it('has no price in built-in presets, and drops a stored preset budget instead of applying it',()=>{
    expect(defaultPresets.some(p=>/원|가격|예산/.test(p.name) || 'maxPrice' in p.conditions)).toBe(false);
    const legacy={id:'mine',category:'food' as const,name:'만원 이하 점심',conditions:{tags:['점심'],excluded:[],maxPrice:10000}};
    expect(validPreset(legacy)).toBe(true);
    const store=decodeStore(JSON.stringify({...emptyStore(),presets:[legacy]}))!;
    expect(store.presets![0].conditions).toEqual({tags:['점심'],excluded:[]});
    expect(applyPreset(newSession(),legacy.conditions).conditions).toEqual({tags:['점심'],excluded:[]});
  });
  it('preserves old stores and rejects damaged presets and duplicate ids',()=>{
    expect(decodeStore(JSON.stringify(emptyStore()))).not.toBeNull();
    expect(decodeStore(JSON.stringify({...emptyStore(),presets:[defaultPresets[0],defaultPresets[0]]}))).toBeNull();
    expect(validPreset({...defaultPresets[0],conditions:{tags:'x',excluded:[]}})).toBe(false);
  });
});
