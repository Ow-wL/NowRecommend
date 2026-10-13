import type {Appearance} from './domain';
export function validAppearance(v:any):v is Appearance {return !!v && ['dark','light','system'].includes(v.mode) && (v.accent===undefined || typeof v.accent==='string' && /^#[\da-f]{6}$/i.test(v.accent));}
const rgb=(hex:string)=>hex.slice(1).match(/../g)!.map(v=>parseInt(v,16));
export function contrast(a:string,b:string):number {
  const luminance=(hex:string)=>{const v=rgb(hex).map(x=>x/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return v[0]*.2126+v[1]*.7152+v[2]*.0722;};const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);
}
const mix=(a:string,b:string,t:number)=>'#'+rgb(a).map((v,i)=>Math.round(v+(rgb(b)[i]-v)*t).toString(16).padStart(2,'0')).join('');
function readable(color:string,backgrounds:string[],towards:string):string {
  for(let i=0;i<=100;i++){const value=mix(color,towards,i/100);if(backgrounds.every(bg=>contrast(value,bg)>=4.5))return value;}return towards;
}
export function accentTokens(color:string,theme:'dark'|'light'):Record<string,string> {
  const selected=mix(theme==='dark'?'#181a1f':'#ffffff',color,.12);
  const foreground=readable(color,theme==='dark'?['#292d35',selected]:['#e4e8ee',selected],theme==='dark'?'#ffffff':'#000000');
  const text=contrast(color,'#000000')>=contrast(color,'#ffffff')?'#000000':'#ffffff';
  return {'--accent':foreground,'--accent-fill':color,'--accent-hover':readable(mix(color,'#ffffff',.1),[text],text==='#000000'?'#ffffff':'#000000'),'--accent-pressed':readable(mix(color,'#000000',.12),[text],text==='#000000'?'#ffffff':'#000000'),'--text-on-accent':text,'--bg-selected':selected};
}
export function applyAppearance(appearance?:Appearance) {
  const mode=appearance?.mode || 'dark',theme=mode==='system'?(window.matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light'):mode;
  const root=document.documentElement;root.dataset.theme=theme;
  const keys=['--accent','--accent-fill','--accent-hover','--accent-pressed','--text-on-accent','--bg-selected'];
  keys.forEach(key=>root.style.removeProperty(key));if(appearance?.accent)Object.entries(accentTokens(appearance.accent,theme)).forEach(([key,value])=>root.style.setProperty(key,value));
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content',theme==='dark'?'#101114':'#f4f6f8');
}
