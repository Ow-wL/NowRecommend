import { describe,it,expect } from 'vitest';
import { applyPreset, defaultPresets, validPreset } from './presets';
import { newSession } from './sessionStorage';
import { changeText, changeBudget } from './domain';
import { decodeStore } from './storage';
import { emptyStore } from './domain';
describe('condition presets',()=>{
  it('built-ins contain valid conditions for their independent category',()=>{expect(defaultPresets.every(validPreset)).toBe(true);expect(validPreset({...defaultPresets[0],category:'music'})).toBe(false);});
  it('overwrites text and budget but never imports exposure or exclusion ids',()=>{
    const session={...changeBudget(changeText(newSession(),'매운 점심'), '9000'),excludedIds:['f01'],seenIds:['f02']};
    const applied=applyPreset(session,defaultPresets[0].conditions);
    expect(applied.raw).toBe('');expect(applied.conditions).toEqual(defaultPresets[0].conditions);expect(applied.excludedIds).toEqual(['f01']);expect(applied.seenIds).toEqual(['f02']);expect(changeText(applied,'').conditions.maxPrice).toBeNull();
  });
  it('preserves old stores and rejects damaged presets and duplicate ids',()=>{
    expect(decodeStore(JSON.stringify(emptyStore()))).not.toBeNull();
    expect(decodeStore(JSON.stringify({...emptyStore(),presets:[defaultPresets[0],defaultPresets[0]]}))).toBeNull();
    expect(validPreset({...defaultPresets[0],conditions:{tags:[],excluded:[],maxPrice:100.5}})).toBe(false);
  });
});
