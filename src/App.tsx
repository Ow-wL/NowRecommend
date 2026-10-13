import { useEffect, useLayoutEffect, useMemo, useRef, useState, useReducer } from 'react';
import { applyAppearance } from './theme';
import { AppearanceSettings } from './components/AppearanceSettings';
import { ArrowLeft, ArrowRight, Check, CheckCheck, ChevronRight, Clock3, Heart, Headphones, House, Info, Leaf, LogOut, Menu, Music2, Plus, Search, Settings2, ShieldCheck, SlidersHorizontal, Sparkles, Trash2, Utensils, X } from 'lucide-react';
import { items, options, exclusions, categoryLabel, type Category, type Item } from './data';
import { emptyConditions, emptyStore, parseConditions, createEditor, changeText, toggleCondition, changeBudget, validateBudget, conditionConflicts, recommend, nextBatch, replaceCandidate, candidateInfo, updateFeedback, type HistoryEntry, type Profile, type Session, type Recommendation, type Feedback, type Preset } from './domain';
import { Comparison } from './components/Comparison';
import { applyPreset } from './presets';
import { Presets, ConditionsSummary } from './components/Presets';
import { Favorites } from './components/Favorites';
import { ItemDetails } from './components/ItemDetails';
import { readStoreResult, writeStore, replaceStore, downloadRecovery, clearDamagedStore } from './storage';
import { DataManagement } from './components/DataManagement';
import { recordRound, selectResult,reviewSelection } from './history';
import { HistoryDetails } from './components/HistoryDetails';
import { Modal, useFocusTrap } from './components/Modal';
import { RecommendationCard } from './components/RecommendationCard';
import { parseRoute, routeFor, viewReducer, type Page, type Step } from './navigation';
import { newSession, readTab, writeTab } from './sessionStorage';

type Dialog = 'about' | 'account' | 'reset' | 'deleteHistory' | 'resetTaste' | null;
const toggle = (values: string[], value: string) => values.includes(value) ? values.filter(v => v !== value) : [...values, value];

export default function App() {
  const [loaded] = useState(readStoreResult);
  const [store, setStore] = useState(loaded.store);
  useLayoutEffect(()=>{const apply=()=>applyAppearance(store.appearance);apply();const media=window.matchMedia('(prefers-color-scheme:dark)');if(store.appearance?.mode!=='system')return;media.addEventListener('change',apply);return ()=>media.removeEventListener('change',apply);},[store.appearance]);
  const [storageBlocked, setStorageBlocked] = useState(loaded.issue === 'damaged');
  const [initial] = useState(readTab);
  const [view, dispatchView] = useReducer(viewReducer, { ...initial.view, ...parseRoute(window.location.hash), step: /#\/(recommend|onboard)\//.test(window.location.hash) ? parseRoute(window.location.hash).step : initial.view.step, category: /#\/(recommend|onboard)\//.test(window.location.hash) ? parseRoute(window.location.hash).category : initial.session.category });
  const { page, category, step } = view;
  const setPage = (page: Page) => dispatchView({ page });
  const setCategory = (category: Category) => dispatchView({ category });
  const setStep = (step: Step) => dispatchView({ step });
  const [session, setSession] = useState<Session>(initial.session);
  const [active, setActive] = useState(initial.active);
  const [completedId, setCompletedId] = useState(initial.completedId || '');
  const completed = store.history.find(h=>h.id === completedId);
  const selectionLock = useRef('');
  const [draftProfile, setDraftProfile] = useState<Profile>(initial.draftProfile || store.profiles[category]);
  const [query, setQuery] = useState(initial.query || '');
  const [selectedOnly, setSelectedOnly] = useState(initial.selectedOnly || false);
  const [onboardSummary, setOnboardSummary] = useState(initial.onboardSummary || false);
  const [editingProfile, setEditingProfile] = useState(initial.editingProfile || false);
  const [filter, setFilter] = useState<'all' | Category>('all');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [feedbackItem, setFeedbackItem] = useState<Item | null>(null);
  const [historyPreview, setHistoryPreview] = useState<HistoryEntry | null>(null);
  const [presetPreview,setPresetPreview]=useState<Preset|null>(null);
  const [savePresetOpen,setSavePresetOpen]=useState(false);
  const [presetName,setPresetName]=useState('');
  const [detail,setDetail]=useState<{item:Item;reasons?:Recommendation}|null>(null);
  const [compareOpen,setCompareOpen]=useState(false);
  const [deleteId, setDeleteId] = useState('');
  const [nameDraft, setNameDraft] = useState(store.name);
  const [busy, setBusy] = useState(false);
  const [requestError, setRequestError] = useState(false);
  const [failNext, setFailNext] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [smallScreen, setSmallScreen] = useState(()=>window.matchMedia('(max-width:1023px)').matches);
  const drawerRef = useRef<HTMLElement>(null);
  useFocusTrap(drawerRef,()=>setMobileNav(false),mobileNav && smallScreen,'.workspace, .skip-link');
  useEffect(()=>{const media=window.matchMedia('(max-width:1023px)');const change=()=>{setSmallScreen(media.matches);if(!media.matches)setMobileNav(false);};media.addEventListener('change',change);return ()=>media.removeEventListener('change',change);},[]);
  const [toastPaused, setToastPaused] = useState(false);
  const [toast, setToast] = useState<{ message: string; undo?: () => void } | null>(null);
  const [storageWarning, setStorageWarning] = useState(false);
  const [tabWarning, setTabWarning] = useState(false);
  const requestCounter = useRef(0);
  const lastHash = useRef(window.location.hash);
  const stateRef = useRef({ session, active, store, view }); stateRef.current = { session, active, store, view };
  useEffect(() => {
    const onHash = () => {
      if (window.location.hash === lastHash.current) return;
      lastHash.current = window.location.hash;
      const next = parseRoute(window.location.hash);
      const current = stateRef.current;
      if (!['recommend','onboard'].includes(next.page)) { next.category = current.session.category; next.step = current.view.step; }
      if (next.page === 'recommend' && (!current.active || current.session.category !== next.category)) {
        const fresh = newSession(next.category);
        setSession({ ...fresh, editor: createEditor('', next.category) }); setActive(true);
        next.step = 'input';
        if (current.store.profiles[next.category].selected.length < 5) { next.page = 'onboard'; setDraftProfile(current.store.profiles[next.category]); setEditingProfile(false); setOnboardSummary(false); }
      }
      dispatchView(next); setMobileNav(false); setRequestError(false);
    };
    window.addEventListener('hashchange', onHash);
    // Direct hash entry must use the same guards as browser navigation.
    lastHash.current = ''; onHash();
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => {
    const hash = routeFor(view);
    if (window.location.hash !== hash) { lastHash.current = hash; window.location.hash = hash; }
  }, [view]);
  useEffect(() => { setTabWarning(!writeTab({ version: 1, view, session, active, draftProfile, editingProfile, onboardSummary, query, selectedOnly, completedId })); }, [view, session, active, draftProfile, editingProfile, onboardSummary, query, selectedOnly, completedId]);
  const previousPage = useRef(page);
  const candidateStatus = candidateInfo(session, store.profiles[session.category]);
  const budgetError = validateBudget(session.editor?.budgetInput ?? '');
  const conflicts = conditionConflicts(session);
  const results = useMemo(() => recommend(session, store.profiles[session.category]), [session, store.profiles]);
  const allPinned=results.length>0 && results.every(r=>session.pinnedIds?.includes(r.item.id));

  useEffect(() => { const failed = storageBlocked || !writeStore(store); setStorageWarning(failed); if (failed) setToast(t=>t ? {...t,message:'이번 변경을 브라우저에 저장하지 못했어요. 화면에서만 유지돼요.'} : null); }, [store, storageBlocked]);
  useEffect(() => { if (page === 'complete' && !completed?.selected) setPage('history'); }, [page, completed]);
  useEffect(() => { if (!toast || toastPaused || dialog || feedbackItem || historyPreview || presetPreview || savePresetOpen || detail || compareOpen) return; const timer = setTimeout(() => setToast(null), 6500); return () => clearTimeout(timer); }, [toast, toastPaused, dialog, feedbackItem, historyPreview, presetPreview, savePresetOpen, detail,compareOpen]);
  useEffect(() => { if (previousPage.current !== page) { window.scrollTo({ top: 0, behavior: 'instant' }); previousPage.current = page; } }, [page]);
  useEffect(() => () => { requestCounter.current++; }, []);
  useEffect(()=>{ const frame=requestAnimationFrame(()=>{window.scrollTo({top:0,behavior:'instant'});const title=document.querySelector<HTMLElement>('main h1');title?.setAttribute('tabindex','-1');title?.focus({preventScroll:true});});return ()=>cancelAnimationFrame(frame);},[page,step,onboardSummary]);

  const notify = (message: string, undo?: () => void) => {setToastPaused(false);setToast({ message: storageWarning ? '화면에 반영했지만 브라우저에는 저장하지 못했어요.' : message, undo });};
  function navigate(next: Page) { requestCounter.current++; setBusy(false); setRequestError(false); setToast(null); setPage(next); setMobileNav(false); setQuery(''); setFilter('all'); }
  function backStep() { requestCounter.current++; setBusy(false); setRequestError(false); if (step === 'input') navigate('home'); else setStep(step === 'results' ? 'confirm' : 'input'); }
  function start(next: Category, raw = '', forceNew = false) {
    if (!forceNew && !raw && active && session.category === next) { setCategory(next); if (store.profiles[next].selected.length < 5 && (category !== next || editingProfile)) {setDraftProfile(store.profiles[next]);setEditingProfile(false);setOnboardSummary(false);setSelectedOnly(false);} navigate(store.profiles[next].selected.length < 5 ? 'onboard' : 'recommend'); return; }
    setActive(true); setSelectedOnly(false);
    requestCounter.current++; setBusy(false); setRequestError(false); setToast(null); setMobileNav(false); setQuery('');
    setCategory(next); setStep('input'); setSession({ ...newSession(next), category: next, raw, conditions: parseConditions(raw, next), editor: createEditor(raw, next), excludedIds: [], revision: 0 });
    if (store.profiles[next].selected.length < 5) { setDraftProfile(store.profiles[next]); setEditingProfile(false); setOnboardSummary(false); setPage('onboard'); }
    else setPage('recommend');
  }
  function endRequest() { setActive(false); setSession(newSession(category)); setStep('input'); navigate('home'); notify('이번 요청을 종료했어요.'); }
  function editTaste(next: Category) { setSelectedOnly(false); setCategory(next); setDraftProfile(store.profiles[next]); setEditingProfile(true); setOnboardSummary(false); setQuery(''); navigate('onboard'); }
  function saveProfile() {
    setStore(s => ({ ...s, profiles: { ...s.profiles, [category]: draftProfile } }));
    if (editingProfile) navigate('taste'); else setPage('recommend');
    notify('내 취향을 저장했어요. 이제 지금의 상황을 알려주세요.');
  }
  function conditionTag(value: string, excluded = false) {
    setSession(s => toggleCondition(s, value, excluded));
  }
  function favorite(id: string) { const saved = store.favorites.includes(id); setStore(s => ({ ...s, favorites: toggle(s.favorites, id) })); notify(saved ? '즐겨찾기에서 해제했어요.' : '즐겨찾기에 저장했어요.'); }
  function record(current: Session, feedback: Feedback[] = []) {
    setStore(s=>({...s,history:recordRound(s.history,current,current.snapshot || recommend(current,s.profiles[current.category]),feedback)}));
  }
  function choose(result: Recommendation) {
    if (!active || !session.id || !session.roundId || selectionLock.current === session.id) return;
    selectionLock.current = session.id;
    const current = session;
    setStore(s=>{ const history=recordRound(s.history,current,current.snapshot || results); return {...s,history:history.map(h=>h.id === current.id ? selectResult(h,result,current.roundId!) : h)}; });
    setCompletedId(current.id!); setActive(false); setSession(newSession(category)); setPage('complete'); setToast(null);
  }
  function reviseSelection(entry: HistoryEntry, result?: Recommendation, roundId = '') {
    const updated = result ? selectResult(entry,result,roundId) : {...entry,selected:undefined,review:undefined};
    setStore(s=>({...s,history:s.history.map(h=>h.id === entry.id ? updated : h)}));
    setHistoryPreview(updated);
  }
  function restoreTemporary(id: string) {
    const current=nextBatch({...session,excludedIds:session.excludedIds.filter(v=>v !== id)},store.profiles[session.category]);
    setSession(current);record(current,[{itemId:id,scope:'session',action:'restore',date:new Date().toISOString()}]);
  }
  function run(again = false, skipFailure = false) {
    if (budgetError || conflicts.length) return;
    setRequestError(false);
    if (failNext && !skipFailure) { setFailNext(false); setRequestError(true); return; }
    const current = nextBatch({ ...session, revision: again ? session.revision + 1 : session.revision }, store.profiles[session.category]);
    setSession(current); record(current); setStep('results');
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  function applyFeedback(scope: 'session' | 'long') {
    if (!feedbackItem) return;
    const id = feedbackItem.id;
    const previousSession = session;
    const next = updateFeedback(store.profiles[category], session, id, scope);
    setStore(s => ({ ...s, profiles: { ...s.profiles, [category]: next.profile } }));
    const displayed = nextBatch(next.session, next.profile);
    setSession(displayed); record(displayed,[{itemId:id,scope,action:'exclude',date:new Date().toISOString()}]); setFeedbackItem(null);
    notify(scope === 'session' ? '이번 추천에서 제외했어요. 새 요청에서는 다시 추천될 수 있어요.' : '장기 비선호에 추가했어요. 다음 추천에도 반영할게요.', () => {
      if (scope === 'long') setStore(s => ({ ...s, profiles: { ...s.profiles, [category]: { ...s.profiles[category], disliked: s.profiles[category].disliked.filter(v => v !== id) } } }));
      const restored = {...previousSession,roundId:crypto.randomUUID(),seenIds:[...new Set([...(displayed.seenIds || []),...(previousSession.seenIds || [])])]};
      setSession(restored);record(restored,[{itemId:id,scope,action:'restore',date:new Date().toISOString()}]);
    });
  }
  function reuse(entry: HistoryEntry) { setHistoryPreview(null); start(entry.category, entry.raw, true); setSession({ ...newSession(entry.category), category: entry.category, raw: entry.raw, conditions: structuredClone(entry.conditions), excludedIds: [], revision: 0 }); }
  function applyPreview() {
    if(!presetPreview) return;
    const current=active && session.category===presetPreview.category ? session : newSession(presetPreview.category);
    start(presetPreview.category,'',true);setSession(applyPreset(current,presetPreview.conditions));setStep('input');setPresetPreview(null);
    notify('프리셋 조건을 적용했어요. 평소 취향은 바뀌지 않아요.');
  }
  function recommendSaved(c:Category,ids:string[]) { start(c,'',true);setSession({...newSession(c),editor:createEditor('',c),candidateScope:'favorites',candidateIds:[...ids]}); }
  function replaceOne(id:string) { const next=replaceCandidate(session,store.profiles[session.category],id);if(!next){notify('교체할 새로운 후보가 없어요. 조건을 바꾸거나 새 요청을 시작해주세요.');return;}setSession(next);record(next);notify('다른 후보로 한 장만 교체했어요.'); }
  function importStore(next:typeof store):string|null {
    if(!replaceStore(next))return '브라우저에 저장하지 못했어요. 기존 데이터는 유지돼요.';
    setStore(next);setStorageBlocked(false);setStorageWarning(false);setSession(newSession());setActive(false);setCompletedId('');setDraftProfile(next.profiles.food);setEditingProfile(false);setOnboardSummary(false);selectionLock.current='';setDialog(null);navigate('home');notify('백업 데이터를 가져왔어요.');return null;
  }
  const presetList=(c:Category)=><Presets category={c} presets={store.presets || []} onPreview={setPresetPreview} onRename={(id,name)=>{setStore(s=>({...s,presets:(s.presets || []).map(p=>p.id===id ? {...p,name} : p)}));notify('프리셋 이름을 변경했어요.');}} onDelete={id=>{const deleted=store.presets?.find(p=>p.id===id);setStore(s=>({...s,presets:(s.presets || []).filter(p=>p.id!==id)}));notify('프리셋을 삭제했어요.',()=>{if(deleted)setStore(s=>({...s,presets:[...(s.presets || []),deleted]}));});}}/>;

  const pageTitle: Record<Page, string> = { home: '홈', recommend: `${categoryLabel[category]} 추천`, onboard: editingProfile ? '취향 편집' : '첫 취향 등록', favorites: '즐겨찾기', history: '추천 기록', taste: '내 취향', login: '체험 시작', complete: '선택 완료' };
  const navItems = [{ page: 'home' as Page, label: '홈', icon: House }, { page: 'recommend' as Page, category: 'food' as Category, label: '음식 추천', icon: Utensils }, { page: 'recommend' as Page, category: 'music' as Category, label: '음악 추천', icon: Headphones }];
  const myItems = [{ page: 'favorites' as Page, label: '즐겨찾기', icon: Heart }, { page: 'history' as Page, label: '추천 기록', icon: Clock3 }, { page: 'taste' as Page, label: '내 취향', icon: SlidersHorizontal }];
  const chips = (values: string[], selected: string[], onClick: (v: string) => void, kind = '') => <div className="chips">{values.map(v => <button key={v} className={`chip ${kind} ${selected.includes(v) ? 'selected' : ''}`} aria-pressed={selected.includes(v)} onClick={() => onClick(v)}>{selected.includes(v) && <Check size={13} />}{v}</button>)}</div>;
  const tabFilter = <div className="filter-tabs" role="group" aria-label="분야 필터">{(['all', 'food', 'music'] as const).map(f => <button key={f} aria-pressed={filter === f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>{f === 'all' ? '전체' : categoryLabel[f]}</button>)}</div>;
  const itemCard = (item: Item, reasons?: { tasteReason: string; contextReason: string }) => <RecommendationCard key={item.id} item={item} saved={store.favorites.includes(item.id)} persisted={!storageWarning} reasons={reasons} onSave={() => favorite(item.id)} onDetails={()=>setDetail({item,reasons:reasons ? {item,...reasons}:undefined})} onExclude={() => setFeedbackItem(item)} onSelect={reasons ? () => choose({item,...reasons}) : undefined} pinned={session.pinnedIds?.includes(item.id)} compared={session.compareIds?.includes(item.id)} compareDisabled={(session.compareIds?.length || 0)>=3 && !session.compareIds?.includes(item.id)} onPin={reasons?()=>setSession(s=>({...s,pinnedIds:toggle(s.pinnedIds || [],item.id)})):undefined} onReplace={reasons?()=>replaceOne(item.id):undefined} onCompare={reasons?()=>setSession(s=>({...s,compareIds:toggle(s.compareIds || [],item.id)})):undefined}/>;

  return <div className="app-shell"><a className="skip-link" href="#main-content" onClick={e=>{e.preventDefault();document.getElementById('main-content')?.focus();}}>본문 바로가기</a>
    {mobileNav && <button className="nav-backdrop" aria-label="메뉴 닫기" onClick={() => setMobileNav(false)} />}
    <aside ref={drawerRef} className={`sidebar ${mobileNav ? 'open' : ''}`} inert={smallScreen && !mobileNav} aria-hidden={smallScreen && !mobileNav ? true : undefined} role={smallScreen && mobileNav ? 'dialog' : undefined} aria-modal={smallScreen && mobileNav ? true : undefined} aria-label={smallScreen && mobileNav ? '탐색 메뉴' : undefined}>
      {mobileNav && <button className="icon-button drawer-close" data-safe-focus aria-label="탐색 메뉴 닫기" onClick={()=>setMobileNav(false)}><X size={20}/></button>}
      <button className="brand" onClick={() => navigate('home')} aria-label="지금 추천 홈"><span className="brand-mark"><Sparkles size={21} fill="currentColor" /></span><span>지금 추천<span className="brand-dot">.</span></span></button>
      <p className="brand-subtitle">오늘의 선택을 더 쉽게</p>
      <nav className="nav-group"><span className="nav-caption">추천 시작</span>{navItems.map(n => <button key={n.label} aria-current={page === n.page && (!n.category || category === n.category) ? 'page' : undefined} className={`nav-link ${page === n.page && (!n.category || category === n.category) ? 'active' : ''}`} onClick={() => n.category ? start(n.category) : navigate(n.page)}><n.icon size={19} /><span>{n.label}</span>{page === n.page && (!n.category || category === n.category) && <span className="nav-active-dot" />}</button>)}</nav>
      <nav className="nav-group"><span className="nav-caption">나의 모음</span>{myItems.map(n => <button key={n.label} aria-current={page === n.page ? 'page' : undefined} className={`nav-link ${page === n.page ? 'active' : ''}`} onClick={() => navigate(n.page)}><n.icon size={19} /><span>{n.label}</span>{n.page === 'favorites' && store.favorites.length > 0 && <span className="nav-count">{store.favorites.length}</span>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="sidebar-note"><Leaf size={22} /><strong>취향은 그대로,<br />오늘은 오늘답게.</strong><p>지금의 기분이 바뀌어도<br />평소 취향은 지켜드릴게요.</p></div><button className="help-link" onClick={() => {setMobileNav(false);setDialog('about');}}><Info size={16} /> 체험 안내 <ArrowRight size={14} /></button><button className="user-panel" onClick={() => { setMobileNav(false);setNameDraft(store.name); setDialog('account'); }}><span className="avatar">{store.name.slice(0, 1)}</span><span><b>{store.name}</b><small>이 브라우저에 저장됨</small></span><Settings2 size={16} /></button></div>
    </aside>
    <div className="workspace"><header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" aria-label="메뉴 열기" onClick={() => setMobileNav(true)}><Menu size={21} /></button><span>나의 오늘</span><ChevronRight size={13} /><b>{pageTitle[page]}</b></div><div className="topbar-right"><span className="demo-badge"><span /> 체험 버전</span><button className="top-avatar" aria-label="브라우저 프로필" onClick={() => { setMobileNav(false);setNameDraft(store.name); setDialog('account'); }}>{store.name.slice(0, 1)}</button></div></header>
      <main tabIndex={-1} id="main-content" className={`main-content ${page}`}>
      {tabWarning && <div className="notice warning" role="status">현재 요청을 탭에 저장하지 못했어요. 새로고침하면 입력과 일시 제외가 사라질 수 있어요.</div>}
      {storageBlocked && <div className="notice warning"><div><strong>저장된 데이터가 손상되어 원본을 보호하고 있어요.</strong><p>현재 변경은 영구 저장하지 않아요. 원본을 내려받아 보관한 뒤 설정에서 초기화할 수 있어요.</p><button className="button secondary" onClick={() => downloadRecovery(loaded.raw || '')}>손상 원본 내려받기</button><button className="text-button" onClick={()=>setDialog('reset')}>초기화 확인</button></div></div>}
      {storageWarning && !storageBlocked && <div className="notice warning">이번 변경을 브라우저에 저장하지 못했어요. 화면에는 반영되지만 새로고침하면 변경 내용이 사라질 수 있어요. <button className="button secondary" onClick={()=>setStorageWarning(!writeStore(store))}>저장 재시도</button></div>}
      {page === 'home' && <>
        <div className="welcome"><div><h1>지금, 어떤 선택이 필요하세요?</h1><p>평소 취향에 오늘의 상황을 더해 골라보세요.</p></div></div>
        <section className="discover-section"><div className="category-grid">{(['food', 'music'] as Category[]).map(c => <button key={c} className={`category-card ${c}-category`} onClick={() => start(c)}><span className="category-icon">{c === 'food' ? <Utensils size={24} /> : <Headphones size={24} />}</span><span className="category-copy"><h2>{c === 'food' ? '오늘 뭐 먹지?' : '지금 뭐 듣지?'}</h2><span>{c === 'food' ? '입맛과 상황에 맞는 한 끼를 찾아요.' : '지금의 기분에 어울리는 음악을 찾아요.'}</span><small>{store.profiles[c].selected.length >= 5 ? '평소 취향 등록됨' : '취향 5개를 골라 시작해요'}</small><span className="category-link">{categoryLabel[c]} 추천받기 <ArrowRight size={16} /></span></span></button>)}</div></section>
        {active && <section className="panel home-history"><h2>진행 중인 {categoryLabel[session.category]} 요청</h2><p>{session.raw || '직접 고른 조건으로 진행 중이에요.'}</p><button className="button primary" onClick={() => start(session.category)}>이어서 추천받기 <ArrowRight size={16} /></button><button className="text-button" onClick={endRequest}>요청 종료</button></section>}
        <section className="panel preset-home">{(['food','music'] as Category[]).map(c=><div key={c}>{presetList(c)}</div>)}</section>
        <section className="panel home-history"><h2>최근 선택</h2>{store.history.some(h=>h.selected) ? store.history.filter(h=>h.selected).slice(0,3).map(h=><div className="recent-choice" key={h.id}><button className="text-button" onClick={()=>setHistoryPreview(h)}>{h.selected!.result.item.name}</button><span className="small">{categoryLabel[h.category]} · 선택한 항목</span></div>) : <><p>아직 선택한 항목이 없어요.</p><button className="text-button" onClick={() => start('food')}>추천 시작하기 <ArrowRight size={16} /></button></>}</section>
      </>}

      {page === 'onboard' && <>
        <button className="back-link" onClick={() => navigate(editingProfile ? 'taste' : 'home')}><ArrowLeft size={15} /> {editingProfile ? '내 취향으로' : '홈으로'}</button><div className="page-heading"><h1>{onboardSummary ? '이 취향으로 시작할까요?' : `평소 좋아하는 ${category === 'food' ? '음식을' : '음악을'} 골라주세요.`}</h1><p>{onboardSummary ? '선택한 항목과 선호 이유를 확인해주세요. 언제든 다시 바꿀 수 있어요.' : '5개 이상 골라주세요. 오늘의 기분보다 평소 좋아하는 것을 떠올려보세요.'}</p></div>
        <div className="onboard-layout"><section className="panel selection-panel">{!onboardSummary ? <><label className="search-field"><Search size={18} /><input aria-label="취향 항목 검색" placeholder={category === 'food' ? '메뉴 이름 검색' : '곡명 또는 아티스트 검색'} value={query} onChange={e => setQuery(e.target.value)} /></label><label className="selected-filter"><input type="checkbox" checked={selectedOnly} onChange={e => setSelectedOnly(e.target.checked)} />선택한 항목만 보기</label><div className="selection-grid">{items.filter(i => i.category === category && (!selectedOnly || draftProfile.selected.includes(i.id)) && `${i.name} ${i.subtitle}`.toLowerCase().includes(query.toLowerCase())).map(i => <button key={i.id} className={`selection-card ${draftProfile.selected.includes(i.id) ? 'selected' : ''}`} aria-pressed={draftProfile.selected.includes(i.id)} onClick={() => setDraftProfile(p => ({ ...p, selected: toggle(p.selected, i.id), disliked: p.disliked.filter(id => id !== i.id) }))}><span className="selection-emoji" aria-hidden="true">{i.emoji}</span><b>{i.name}</b>{category === 'music' && <small>{i.subtitle}</small>}<span className="selection-check">{draftProfile.selected.includes(i.id) ? <Check size={14} /> : <Plus size={14} />}</span></button>)}</div>{!items.some(i => i.category === category && (!selectedOnly || draftProfile.selected.includes(i.id)) && `${i.name} ${i.subtitle}`.toLowerCase().includes(query.toLowerCase())) && <p className="empty-small">일치하는 항목이 없어요. <button className="text-button" onClick={() => { setQuery(''); setSelectedOnly(false); }}>검색·필터 초기화</button></p>}</> : <><h2>좋아하는 {categoryLabel[category]}</h2><div className="summary-items">{draftProfile.selected.map(id => items.find(i => i.id === id)).filter((i): i is Item => !!i).map(i => <span key={i.id}>{i.emoji} {i.name}</span>)}</div><h2>좋아하는 이유</h2><p>{draftProfile.tags.join(' · ') || '선택한 항목을 바탕으로 취향을 참고할게요.'}</p><div className="notice"><ShieldCheck size={18} /> 음식과 음악의 취향은 각각 따로 저장해요.</div></>}</section><aside className="panel selection-summary"><span className="step-small">{onboardSummary ? '02' : '01'} / 02</span><h3>조금씩 알아갈게요.</h3><p>많이 고민하지 않아도 괜찮아요.<br />좋아하는 것부터 시작하면 돼요.</p><div className="selection-progress"><strong>{draftProfile.selected.length}<small> / 최소 5개</small></strong><div><span style={{ width: `${Math.min(draftProfile.selected.length / 5, 1) * 100}%` }} /></div></div><p className="selection-help" role="status">{draftProfile.selected.length}개 선택 · {draftProfile.selected.length < 5 ? `${5 - draftProfile.selected.length}개 더 골라주세요` : '다음 단계로 진행할 수 있어요'}</p><h4>어떤 점이 좋아요? <small>선택 사항</small></h4>{chips(options[category].filter(t => !['혼자', '함께', '점심', '저녁', '과제', '운동', '산책', '휴식'].includes(t)), draftProfile.tags, v => setDraftProfile(p => ({ ...p, tags: toggle(p.tags, v) })))}<button className="button primary full-width desktop-progress" disabled={draftProfile.selected.length < 5} onClick={() => onboardSummary ? saveProfile() : setOnboardSummary(true)}>{onboardSummary ? '확인하고 저장' : '취향 요약 확인'}<ArrowRight size={16} /></button>{onboardSummary && <button className="text-button centered" onClick={() => setOnboardSummary(false)}>다시 고르기</button>}</aside></div>{smallScreen && <div className="mobile-progress"><span>{draftProfile.selected.length}개 선택 · {draftProfile.selected.length < 5 ? `${5-draftProfile.selected.length}개 더 선택` : '진행 가능'}</span><button className="button primary" disabled={draftProfile.selected.length < 5} onClick={() => onboardSummary ? saveProfile() : setOnboardSummary(true)}>{onboardSummary ? '확인하고 저장' : '취향 요약 확인'}</button></div>}
      </>}

      {page === 'recommend' && <>
        {session.candidateScope==='favorites' && <div className="notice"><div><strong>저장한 후보 {session.candidateIds?.length || 0}개 안에서 추천</strong><p>요청 시작 시 검색·태그로 고른 즐겨찾기 범위예요. 필수 제외·예산·비선호는 그대로 적용해요.</p><button className="button secondary" onClick={()=>{setSession(s=>({...s,candidateScope:undefined,candidateIds:undefined,currentIds:undefined,snapshot:undefined}));setStep('confirm');}}>전체 후보로 전환</button></div></div>}
        <div className="recommend-top"><button className="back-link" onClick={backStep}><ArrowLeft size={15} /> {step === 'input' ? '홈으로' : '이전 단계'}</button><div className="stepper">{['상황 입력', '조건 확인', '추천 결과'].map((label, index) => { const current = ['input', 'confirm', 'results'].indexOf(step); return <span key={label} className={current === index ? 'current' : current > index ? 'done' : ''}><i>{current > index ? <Check size={11} /> : index + 1}</i>{label}{index < 2 && <ChevronRight size={12} />}</span>; })}</div></div>
        <div className="page-heading"><h1>{step === 'input' ? (category === 'food' ? '지금, 어떤 한 끼가 필요하세요?' : '지금, 어떤 음악이 필요하세요?') : step === 'confirm' ? '이 조건으로 찾아볼까요?' : (category === 'food' ? '지금의 당신을 위한 메뉴' : '지금의 당신을 위한 음악')}</h1><p>{step === 'input' ? '오늘의 상황을 편하게 적어주세요. 선택 항목만 골라도 괜찮아요.' : step === 'confirm' ? '추천 전에 한 번만 확인해주세요. 조건을 더하거나 지울 수 있어요.' : '평소 취향에 지금의 조건을 더했어요. 마음에 드는 선택을 발견해보세요.'}</p></div>
        {step !== 'results' ? <div className="composer-layout"><section className="panel composer">
          {step === 'input' ? <><label className="field-title" htmlFor="situation">지금의 상황 <span>자유롭게 적어주세요</span></label><textarea id="situation" maxLength={300} value={session.raw} onChange={e => setSession(s => changeText(s, e.target.value))} placeholder={category === 'food' ? '예: 혼자 먹을 담백하고 따뜻한 저녁이 먹고 싶어' : '예: 과제하면서 들을 차분한 연주곡을 추천해줘'} /><div className="textarea-caption"><span>일상적인 문장으로 시작해보세요</span><span>{session.raw.length}/300</span></div><div className="example-row"><span>예를 들면</span>{(category === 'food' ? ['혼자 먹을 담백한 저녁', '매콤한 점심, 만원 이하'] : ['과제할 때 듣는 연주곡', '산책할 때 활기찬 음악']).map(text => <button key={text} onClick={() => setSession(s => changeText(s, text))}>{text}<Plus size={12} /></button>)}</div><div className="form-divider" />{(category === 'food' ? [{label:'상황', values:['혼자','함께','점심','저녁']}, {label:'원하는 맛·특징', values:options.food.filter(t => !['혼자','함께','점심','저녁'].includes(t))}] : [{label:'활동',values:['과제','휴식','산책','운동']},{label:'분위기',values:options.music.filter(t => !['과제','휴식','산책','운동','보컬','연주곡'].includes(t))},{label:'보컬',values:['보컬','연주곡']}]).map(group => <div key={group.label}><h3>{group.label} <small>선택 사항</small></h3>{chips(group.values,session.conditions.tags,v=>conditionTag(v))}</div>)}</> : <><div className="quote-box"><span>내가 입력한 상황</span><p>“{session.raw || '직접 선택한 조건으로 추천받기'}”</p></div><h3><ShieldCheck size={17} /> 반드시 제외할 항목 <small>선호 조건보다 먼저 적용해요</small></h3>{chips(exclusions[category], session.conditions.excluded, v => conditionTag(v, true), 'exclude')}<h3>이번 요청에 반영할 조건</h3><p className="form-description">선택한 조건을 누르면 해제돼요. 빠진 조건은 아래에서 추가하세요.</p>{session.conditions.tags.length ? <div className="chips">{session.conditions.tags.map(t => <button className="chip selected" key={t} onClick={() => conditionTag(t)} aria-label={`${t} 조건 삭제`}>{t}<X size={13} /></button>)}</div> : <div className="empty-small">선호 조건이 없어요. 평소 취향을 중심으로 추천할게요.</div>}<details className="add-conditions"><summary><Plus size={15} /> 조건 추가하기</summary>{chips(options[category].filter(t => !session.conditions.tags.includes(t)), [], v => conditionTag(v))}</details><div className="form-divider" /></>}
          {step === 'input' && <><h3><ShieldCheck size={17} /> 반드시 제외할 항목 <small>선호 조건보다 먼저 적용해요</small></h3>{chips(exclusions[category], session.conditions.excluded, v => conditionTag(v, true), 'exclude')}</>}
          {category === 'food' && <div className="budget-editor"><label className="budget-field" htmlFor="budget">참고 예산 상한 (원)<input id="budget" aria-label="참고 예산 상한" inputMode="numeric" value={session.editor?.budgetInput ?? String(session.conditions.maxPrice ?? '')} onChange={e => setSession(s => changeBudget(s, e.target.value))} aria-invalid={!!budgetError} aria-describedby="budget-help budget-error" placeholder="제한 없음" /></label><p id="budget-help" className="small">직접 입력한 예산이 문장에서 찾은 예산보다 우선해요. 빈 입력은 제한 없음이에요. 샘플의 기준 가격으로 비교하며 실제 판매 가격과 다를 수 있어요.</p>{budgetError && <p id="budget-error" role="alert" className="danger">{budgetError}</p>}{session.editor?.budgetInput !== undefined && session.editor.automatic.maxPrice !== null && session.conditions.maxPrice !== session.editor.automatic.maxPrice && <p className="small">문장에서 찾은 {session.editor.automatic.maxPrice.toLocaleString()}원 대신 직접 입력한 예산을 적용해요.</p>}</div>}
          {conflicts.length > 0 && <div className="error-box" role="alert">함께 적용할 수 없는 조건이 있어요: {conflicts.join(', ')}. 조건을 해제한 뒤 진행해주세요.</div>}
          {presetList(category)}<button className="button secondary" disabled={!!budgetError || conflicts.length>0 || (store.presets || []).filter(p=>p.category===category).length>=20} onClick={()=>{setPresetName('');setSavePresetOpen(true);}}>현재 조건을 프리셋으로 저장</button><p className="small">분야별 최대 20개 · 상황 문장, 취향, 이번 요청 제외는 저장하지 않아요.</p>
          <p className="parser-help small">지원 표현: {category === 'food' ? '8천원, 1만 5천원, 15,000원, 이만원 이하, 안 매운, 밀 제외' : '과제, 산책, 차분한, 활기찬, 연주곡, 보컬 없는'}. 아래에 표시된 조건만 적용하며 그 밖의 표현은 해석하지 못할 수 있어요.</p>

          {requestError && <div className="error-box" role="alert"><strong>조건 확인을 잠시 완료하지 못했어요.</strong><p>다시 시도하거나, 지금 직접 고른 조건으로 추천받을 수 있어요.</p><button className="text-button" disabled={!!budgetError || conflicts.length > 0} onClick={() => run(false, true)}>직접 선택한 조건으로 계속 <ArrowRight size={14} /></button></div>}
          <div className="form-actions"><span><ShieldCheck size={14} /> 오늘의 조건은 평소 취향을 바꾸지 않아요</span><button className="button primary" disabled={busy || !!budgetError || conflicts.length > 0} onClick={() => { if (step === 'input') { setSession(s => changeText(s, s.raw)); setStep('confirm'); } else run(); }}>{busy ? <span className="spinner" /> : <Sparkles size={16} />}{busy ? '추천을 고르는 중' : step === 'input' ? '조건 확인하기' : requestError ? '다시 시도하기' : '추천받기'}{!busy && <ArrowRight size={15} />}</button></div>
        </section><aside className="context-sidebar"><div className="panel context-profile"><span className={`small-icon ${category}`}>{category === 'food' ? <Utensils size={19} /> : <Headphones size={19} />}</span><h3>평소의 나는</h3><p>오늘의 요청과 따로 기억하고 있어요.</p><div className="mini-tags">{store.profiles[category].tags.map(t => <span key={t}>{t}</span>)}</div><div className="profile-picked">{store.profiles[category].selected.slice(0, 5).map(id => { const i = items.find(i => i.id === id); return i ? <span key={id}>{i.emoji} {i.name}</span> : null; })}</div><button className="text-button" onClick={() => editTaste(category)}>취향 수정 <ArrowRight size={14} /></button></div><div className="gentle-tip"><Leaf size={20} /><h4>오늘은 달라도 괜찮아요.</h4><p>평소 매운 음식을 좋아해도<br />오늘은 담백한 한 끼를 고를 수 있죠.<br />지금의 선택에 집중해보세요.</p></div></aside></div> : <>
          <div className="result-summary"><div><span className="summary-label">이번 요청</span><strong>{session.raw || '직접 선택한 조건'}</strong><div className="mini-tags">{session.conditions.tags.map(t => <span key={t}>{t}</span>)}{session.conditions.excluded.map(t => <span className="excluded-tag" key={t}>{t} 제외</span>)}{session.conditions.maxPrice !== null && <span>{session.conditions.maxPrice.toLocaleString()}원 이하</span>}</div></div><button className="button secondary" disabled={busy} onClick={() => { setStep('confirm'); setRequestError(false); }}><SlidersHorizontal size={15} /> 조건 수정</button></div>
          <div className="section-heading result-heading"><h2>{category === 'food' ? '오늘의 메뉴' : '오늘의 플레이리스트'} <span className="count">{results.length}</span></h2><span>{category === 'food' ? '조건에 맞는 후보를 비교해보세요' : '곡을 골라 외부 검색으로 이어가세요'}</span></div>
          {results.length < (category === 'food' ? 3 : 5) && <div className="notice warning"><Info size={18} /><div><strong>{results.length ? '조건에 맞는 후보가 조금 부족해요.' : '지금 조건에 맞는 후보가 없어요.'}</strong><p>등록 데이터에서 필수 제외·장기 비선호·이번 요청 제외·예산을 적용한 후보는 {candidateStatus.count}개예요. {candidateStatus.budgetRemoved > 0 ? `그중 예산 때문에 추가로 빠진 후보는 ${candidateStatus.budgetRemoved}개예요.` : '예산만 변경해서 늘어나는 후보는 없을 수 있어요.'} 필수 제외는 자동으로 완화하지 않아요.</p>{candidateStatus.suggestions.map(s => <button key={s.price} className="text-button" onClick={() => { setSession(current => changeBudget(current, String(s.price))); setStep('confirm'); }}>예산을 {s.price.toLocaleString()}원으로 변경하면 후보 {s.gain}개 추가</button>)}<button className="text-button" onClick={() => setStep('confirm')}>조건 조정하기 <ArrowRight size={14} /></button></div></div>}
          {session.batchNewCount !== undefined && session.batchNewCount < results.length && <div className="notice" role="status"><Info size={18} /><div><strong>{session.batchNewCount === 0 ? '새로운 후보를 모두 살펴봤어요.' : `새 후보 ${session.batchNewCount}개 + 이전 후보 ${results.length - session.batchNewCount}개`}</strong><p>적합도 순서로 이전 후보를 다시 보여드려요. 조건을 바꾸거나 새 요청을 시작할 수 있어요.</p></div></div>}
          <div className={`result-grid ${category}`}>{results.map(r => itemCard(r.item, r))}</div>
          <div className="comparison-toolbar"><span>비교 {session.compareIds?.length || 0}/3 · 고정 {session.pinnedIds?.length || 0}개 (이번 요청만)</span><button className="button secondary" disabled={results.filter(r=>session.compareIds?.includes(r.item.id)).length<2} onClick={()=>setCompareOpen(true)}>선택한 후보 비교</button><button className="text-button" onClick={()=>setSession(s=>({...s,compareIds:[]}))}>비교 선택 비우기</button></div>
          {requestError && <div className="error-box" role="alert">재추천을 완료하지 못했어요. 아래 버튼으로 다시 시도해주세요.</div>}
          <div className="reroll-panel"><div><span className="small-icon"><Sparkles size={20} /></span><div><h3>조금 다른 선택도 궁금한가요?</h3><p>{allPinned?'모든 후보를 고정했어요. 하나 이상 고정을 해제하면 재추천할 수 있어요.':'지금의 조건과 고정 후보를 유지하고 다른 후보를 살펴보세요.'}</p></div></div><button className="button secondary" disabled={busy || results.length === 0 || allPinned} onClick={() => run(true)}>{busy ? <span className="spinner" /> : <Sparkles size={16} />}{busy ? '다른 추천을 고르는 중' : '다른 추천 보기'}</button></div>
          {session.excludedIds.length > 0 && <div className="temporary-exclusions"><span>이번 요청에서만 제외</span>{session.excludedIds.map(id => <button key={id} onClick={() => restoreTemporary(id)}>{items.find(i => i.id === id)?.name}<X size={12} /></button>)}</div>}
          <div className="new-session-link"><button className="text-button" onClick={() => start(category, '', true)}>새 요청 시작 <ArrowRight size={15} /></button><button className="text-button" onClick={endRequest}>요청 종료</button></div>
        </>}
      </>}

      {page === 'complete' && completed?.selected && <><div className="page-heading"><CheckCheck size={32} className="success-icon" /><h1>오늘의 선택을 남겼어요</h1><p>선택한 항목을 기록했어요. 실제 식사·감상 완료를 뜻하지 않아요.</p></div><section className="panel completion-panel"><h2>{completed.selected.result.item.name}</h2><p>{completed.selected.result.item.subtitle}</p><div className="reasons"><p><b>평소 취향</b>{completed.selected.result.tasteReason}</p><p><b>이번 상황</b>{completed.selected.result.contextReason}</p></div><p>당시 상황: {completed.raw}</p><div className="mini-tags">{completed.conditions.tags.map(t=><span key={t}>{t}</span>)}{completed.conditions.excluded.map(t=><span key={t}>{t} 제외</span>)}{completed.conditions.maxPrice !== null && <span>{completed.conditions.maxPrice.toLocaleString()}원 이하</span>}</div>{completed.category === 'music' && <a className="text-button" target="_blank" rel="noopener noreferrer" href={`https://www.youtube.com/results?search_query=${encodeURIComponent(completed.selected.result.item.subtitle+' '+completed.selected.result.item.name)}`} aria-label="YouTube에서 검색 (새 탭)">YouTube에서 검색 <ArrowRight size={16} /></a>}<div className="card-actions"><button className="button primary" onClick={()=>navigate('history')}>추천 기록 보기</button><button className="button secondary" onClick={()=>setHistoryPreview(completed)}>선택 변경</button><button className="button secondary" onClick={()=>start(completed.category,'',true)}>새 요청 시작</button></div></section></>}

      {page === 'favorites' && <Favorites ids={store.favorites} card={itemCard} onRecommend={recommendSaved} onStart={start}/>}
      {page === 'history' && <><div className="page-heading"><h1>그날의 선택, 그때의 취향.</h1><p>지난 추천의 조건과 결과를 확인하고 같은 상황으로 다시 시작해보세요.</p></div>{tabFilter}<div className="history-list">{store.history.filter(h => filter === 'all' || h.category === filter).map(h => <article className="history-row" key={h.id}><span className={`small-icon ${h.category}`}>{h.category === 'food' ? <Utensils size={22} /> : <Headphones size={22} />}</span><div className="history-content"><span>{categoryLabel[h.category]} 추천 · {new Intl.DateTimeFormat('ko-KR', { month: 'short', day: 'numeric', hour: 'numeric', minute: 'numeric', timeZone: 'Asia/Seoul' }).format(new Date(h.date))}</span><button className="history-title" onClick={() => setHistoryPreview(h)}>{h.raw}</button><p>{h.selected ? `최종 선택: ${h.selected.result.item.name}` : h.legacy ? '이전 버전 기록 · 최종 선택 미등록' : h.rounds.at(-1)?.results.map(r=>r.item.name).join(' · ') || '조건에 맞는 결과 없음'}</p></div><button className="button secondary compact" onClick={() => reuse(h)}>다시 추천 <ArrowRight size={14} /></button><button className="icon-button" aria-label={`${h.raw} 기록 삭제`} onClick={() => { setDeleteId(h.id); setDialog('deleteHistory'); }}><Trash2 size={16} /></button></article>)}</div>{!store.history.some(h => filter === 'all' || h.category === filter) && <div className="empty-state"><span><Clock3 size={30} /></span><h3>첫 번째 선택을 기다리고 있어요.</h3><p>추천받은 상황과 결과를 여기에서 다시 볼 수 있어요.</p><button className="button primary" onClick={() => start(filter === 'music' ? 'music' : 'food')}>추천 시작하기 <ArrowRight size={16} /></button></div>}</>}
      {page === 'taste' && <><div className="page-heading"><h1>내 취향은, 내가 정해요.</h1><p>평소 좋아하는 것과 원하지 않는 것을 따로 관리해요.</p></div><div className="taste-grid">{(['food', 'music'] as Category[]).map(c => <section className="panel taste-panel" key={c}><div className="section-heading"><h2><span className={`small-icon ${c}`}>{c === 'food' ? <Utensils size={18} /> : <Music2 size={18} />}</span>{categoryLabel[c]} 취향</h2><button className="text-button" onClick={() => editTaste(c)}>{store.profiles[c].selected.length >= 5 ? '편집하기' : '등록하기'}<ArrowRight size={14} /></button></div><h4>처음 고른 선호 항목</h4><div className="summary-items">{store.profiles[c].selected.map(id => { const i = items.find(i => i.id === id); return i ? <span key={id}>{i.emoji} {i.name}</span> : null; })}</div>{!store.profiles[c].selected.length && <p className="muted">아직 취향을 등록하지 않았어요.</p>}<div className="mini-tags">{store.profiles[c].tags.map(t => <span key={t}>{t}</span>)}</div><div className="form-divider" /><h4>피드백으로 추가한 장기 비선호 <span>{store.profiles[c].disliked.length}</span></h4><p className="form-description">개별 항목만 제외해요. 비슷한 메뉴나 장르까지 확대하지 않아요.</p><div className="chips">{store.profiles[c].disliked.map(id => <button className="chip exclude selected" key={id} aria-label={`${items.find(i => i.id === id)?.name} 비선호 해제`} onClick={() => { setStore(s => ({ ...s, profiles: { ...s.profiles, [c]: { ...s.profiles[c], disliked: s.profiles[c].disliked.filter(v => v !== id) } } })); notify('장기 비선호를 해제했어요.'); }}>{items.find(i => i.id === id)?.name}<X size={13} /></button>)}</div>{!store.profiles[c].disliked.length && <p className="muted small">등록된 장기 비선호가 없어요.</p>}<button className="text-button danger reset-taste" onClick={() => { setCategory(c); setDialog('resetTaste'); }}>이 분야 취향 초기화</button></section>)}</div><div className="notice"><ShieldCheck size={20} /><div><strong>‘이번 요청에서 제외’는 내 취향에 남지 않아요.</strong><p>음식과 음악은 각각 독립적으로 기억해요. 다른 분야의 취향을 임의로 추측하지 않아요.</p></div></div></>}
      {page === 'login' && <div className="login-panel panel"><span className="brand-mark"><Sparkles size={26} /></span><h1>당신의 취향에서 시작해요.</h1><p>이름만 입력하고 체험을 이어가세요.<br />실제 회원가입 없이 화면 흐름을 살펴볼 수 있어요.</p><form onSubmit={e => { e.preventDefault(); setStore(s => ({ ...s, name: nameDraft.trim() || '취향 탐험가' })); navigate('home'); }}><label className="field-title" htmlFor="demo-name">체험 이름</label><input id="demo-name" required maxLength={16} placeholder="어떻게 불러드릴까요?" value={nameDraft} onChange={e => setNameDraft(e.target.value)} /><button className="button primary full-width">체험 시작하기 <ArrowRight size={17} /></button></form></div>}
      <footer className="footer"><span><Sparkles size={13} /> 지금 추천</span><span>평소의 나와, 지금의 나를 함께.</span><button onClick={() => {setMobileNav(false);setDialog('about');}}>체험 안내</button></footer>
      </main>
    </div>
    {toast && !dialog && !feedbackItem && !historyPreview && !detail && !presetPreview && !savePresetOpen && !compareOpen && <div className="toast" role="status" onMouseEnter={()=>setToastPaused(true)} onMouseLeave={()=>setToastPaused(false)} onFocus={()=>setToastPaused(true)} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))setToastPaused(false);}}><CheckCheck size={18} /><span>{toast.message}</span>{toast.undo && <button onClick={() => { toast.undo?.(); setToast(null); }}>되돌리기</button>}<button className="icon-button" aria-label="알림 닫기" onClick={() => setToast(null)}><X size={15} /></button></div>}
    {feedbackItem && <Modal title="어떤 이유로 바꾸고 싶으세요?" onClose={() => setFeedbackItem(null)}><p className="modal-description"><b>{feedbackItem.name}</b>에 대한 의견을 어디까지 반영할지 골라주세요.</p><button className="feedback-option" onClick={() => applyFeedback('session')}><span className="small-icon food"><Clock3 size={21} /></span><span><b>이번 요청에서 제외</b><small>이번 요청에서만 빼고 다른 항목을 추천해요.<br />새로운 상황으로 시작하면 다시 만날 수 있어요.</small></span><ChevronRight size={19} /></button><button className="feedback-option" onClick={() => applyFeedback('long')}><span className="small-icon music"><SlidersHorizontal size={21} /></span><span><b>원래 내 취향이 아님</b><small>이 항목을 장기 비선호에 저장해요.<br />다음 요청에서도 제외하며, 내 취향에서 해제할 수 있어요.</small></span><ChevronRight size={19} /></button><button className="button secondary full-width" onClick={() => setFeedbackItem(null)}>취소</button></Modal>}
    {historyPreview && <Modal title="그때의 추천" onClose={() => setHistoryPreview(null)}><HistoryDetails entry={historyPreview} persisted={!storageWarning} onSelect={(result,roundId)=>reviseSelection(historyPreview,result,roundId)} onCancel={()=>reviseSelection(historyPreview)} onReview={(rating,note)=>{const next=reviewSelection(historyPreview,rating,note);setStore(s=>({...s,history:s.history.map(h=>h.id===next.id?next:h)}));setHistoryPreview(next);}}/><button className="button primary full-width" onClick={() => reuse(historyPreview)}>같은 조건으로 다시 추천 <ArrowRight size={16} /></button></Modal>}
    {presetPreview && <Modal title={`${presetPreview.name} 적용 확인`} onClose={()=>setPresetPreview(null)}><p>이 {categoryLabel[presetPreview.category]} 조건으로 현재 입력 문장·조건·예산을 바꿔요. 평소 취향은 바꾸지 않아요. 같은 분야의 진행 중 요청이 있으면 이번 요청 제외는 유지해요.</p><ConditionsSummary conditions={presetPreview.conditions}/><div className="modal-actions"><button data-safe-focus className="button secondary" onClick={()=>setPresetPreview(null)}>취소</button><button className="button primary" onClick={applyPreview}>이 조건 적용</button></div></Modal>}
    {detail && <Modal title={detail.item.name} onClose={()=>setDetail(null)}><ItemDetails item={detail.item} reasons={detail.reasons}/></Modal>}
    {compareOpen && <Modal title="후보 비교" onClose={()=>setCompareOpen(false)}><Comparison results={results.filter(r=>session.compareIds?.includes(r.item.id))} onChoose={r=>{setCompareOpen(false);choose(r);}}/></Modal>}
    {savePresetOpen && <Modal title="내 조건 저장" onClose={()=>setSavePresetOpen(false)}><ConditionsSummary conditions={session.conditions}/><form onSubmit={e=>{e.preventDefault();if(!presetName.trim())return;const preset:Preset={id:crypto.randomUUID(),category:session.category,name:presetName.trim(),conditions:structuredClone(session.conditions)};setStore(s=>({...s,presets:[...(s.presets || []),preset]}));setSavePresetOpen(false);notify('조건 프리셋을 저장했어요.');}}><label className="field-title" htmlFor="preset-name">프리셋 이름</label><input id="preset-name" value={presetName} required maxLength={30} onChange={e=>setPresetName(e.target.value)}/><button className="button primary">프리셋 저장</button></form></Modal>}
    {dialog === 'about' && <Modal title="지금 추천을 먼저 경험해보세요." onClose={() => setDialog(null)}><p className="modal-description">취향 등록부터 조건 수정, 추천과 피드백까지 직접 사용해볼 수 있는 체험 버전이에요.</p><div className="about-list"><p><Check size={17} /> 음식 16개와 음악 15곡의 예시 데이터로 추천해요.</p><p><Check size={17} /> 문장의 알려진 표현을 조건으로 바꿔요. 실제 AI 연결 전이라 놓친 조건은 직접 수정해주세요.</p><p><Check size={17} /> 취향·즐겨찾기·최근 50개 기록은 이 브라우저에 저장해요.</p><p><Check size={17} /> 계정 인증과 실제 주문·음원 재생은 포함하지 않아요.</p></div><div className="demo-tools"><h4>실패 화면도 살펴볼까요?</h4><p>다음 추천 요청 한 번에 오류 안내를 표시해요. 재시도와 수동 진행을 확인할 수 있어요.</p><button className="button secondary full-width" onClick={() => { setFailNext(true); setDialog(null); notify('다음 추천 요청에서 실패 안내를 체험할 수 있어요.'); }}>다음 추천 실패 체험하기</button></div></Modal>}
    {dialog === 'account' && <Modal title="브라우저 프로필·설정" onClose={() => setDialog(null)}><p className="modal-description">취향과 기록은 이 브라우저에만 저장돼요. 기기 간 동기화는 지원하지 않아요. 이름을 바꿀 수 있어요.</p><form onSubmit={e => { e.preventDefault(); setStore(s => ({ ...s, name: nameDraft.trim() || '취향 탐험가' })); setDialog(null); notify('체험 이름을 변경했어요.'); }}><label className="field-title" htmlFor="account-name">이름</label><input id="account-name" value={nameDraft} maxLength={16} required onChange={e => setNameDraft(e.target.value)} /><button className="button primary full-width">변경 저장</button></form><AppearanceSettings value={store.appearance} onChange={appearance=>setStore(s=>({...s,appearance}))}/><DataManagement store={store} damagedRaw={storageBlocked?loaded.raw:undefined} onImport={importStore} onReset={scope=>{setStore(s=>({...s,[scope]:scope==='profiles'?emptyStore().profiles:[]}));if(scope==='profiles'){setActive(false);setSession(newSession(category));setDraftProfile(emptyStore().profiles[category]);}notify('선택한 데이터를 초기화했어요.');}}/><div className="account-links"><button onClick={() => { setDialog(null); setNameDraft(store.name); navigate('login'); }}><LogOut size={17} /> 체험 나가기</button><button className="danger" onClick={() => setDialog('reset')}><Trash2 size={17} /> 체험 데이터 모두 초기화</button></div></Modal>}
    {['reset', 'deleteHistory', 'resetTaste'].includes(dialog || '') && <Modal title={dialog === 'reset' ? '체험 데이터를 초기화할까요?' : dialog === 'resetTaste' ? `${categoryLabel[category]} 취향을 초기화할까요?` : '이 추천 기록을 삭제할까요?'} onClose={() => setDialog(null)}><p className="modal-description">{dialog === 'reset' ? '이 브라우저의 취향, 즐겨찾기와 추천 기록을 모두 삭제해요.' : dialog === 'resetTaste' ? '이 분야의 선호 항목과 장기 비선호를 삭제해요. 즐겨찾기와 기록은 유지해요.' : '삭제한 기록은 복구할 수 없어요. 취향과 즐겨찾기는 유지해요.'}</p><div className="modal-actions"><button data-safe-focus className="button secondary" onClick={() => setDialog(null)}>취소</button><button className="button danger-button" onClick={() => { if (dialog === 'reset') { if (!clearDamagedStore()) { notify('데이터를 삭제하지 못했어요.'); setDialog(null); return; } setStorageBlocked(false); setStore(emptyStore()); setSession(newSession()); setActive(false); setToast(null); navigate('home'); } else if (dialog === 'resetTaste') { setStore(s => ({ ...s, profiles: { ...s.profiles, [category]: { selected: [], tags: [], disliked: [] } } })); } else setStore(s => ({ ...s, history: s.history.filter(h => h.id !== deleteId) })); setDialog(null); notify('삭제했어요.'); }}>삭제하기</button></div></Modal>}
  </div>;
}
