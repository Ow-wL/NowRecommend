import { exclusions, options, type Category } from './data';
import { getCatalog } from './catalog';
import { emptyConditions, type Conditions, type Preset, type Session } from './domain';
import { validConditions } from './sessionStorage';

export const defaultPresets: Preset[] = [
  { id:'default-food-evening', category:'food', name:'담백한 저녁', conditions:{tags:['담백함','저녁'],excluded:[],maxPrice:null} },
  { id:'default-food-lunch', category:'food', name:'만원 이하 점심', conditions:{tags:['점심','혼자'],excluded:[],maxPrice:10000} },
  { id:'default-food-mild', category:'food', name:'맵지 않은 한 끼', conditions:{tags:['따뜻함'],excluded:['매콤함'],maxPrice:null} },
  { id:'default-music-study', category:'music', name:'집중하는 연주곡', conditions:{tags:['과제','차분함','연주곡'],excluded:['보컬'],maxPrice:null} },
  { id:'default-music-walk', category:'music', name:'활기찬 산책', conditions:{tags:['산책','활기참'],excluded:[],maxPrice:null} },
  { id:'default-music-rest', category:'music', name:'차분한 휴식', conditions:{tags:['휴식','차분함'],excluded:[],maxPrice:null} },
];
export function validPreset(value: any): value is Preset {
  if (!value || typeof value.id !== 'string' || !value.id.length || value.id.length > 100 || !['food','music'].includes(value.category) || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 30 || !validConditions(value.conditions)) return false;
  const category = value.category as Category;
  const tags = new Set([...options[category], ...getCatalog().items.filter(i=>i.category === category).flatMap(i=>i.tags)]);
  return value.conditions.tags.every((t:string)=>tags.has(t)) && value.conditions.excluded.every((t:string)=>exclusions[category].includes(t)) && (category === 'food' || value.conditions.maxPrice === null) && (value.conditions.maxPrice === null || Number.isInteger(value.conditions.maxPrice));
}
export function applyPreset(session: Session, conditions: Conditions): Session {
  const manual = structuredClone(conditions);
  return { ...session, raw:'', conditions:manual, editor:{parsedRaw:'',automatic:emptyConditions(),manual,removedTags:[],removedExcluded:[],budgetInput:manual.maxPrice === null ? '' : String(manual.maxPrice)}, revision:0,currentIds:undefined,snapshot:undefined };
}
