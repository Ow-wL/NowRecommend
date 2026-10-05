import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Check, CheckCheck, ChevronRight, Clock3, Heart, Headphones, House, Info, Leaf, LogOut, Menu, Music2, Plus, Search, Settings2, ShieldCheck, SlidersHorizontal, Sparkles, Trash2, Utensils, X } from 'lucide-react';
import { items, options, exclusions, categoryLabel, type Category, type Item } from './data';
import { emptyConditions, emptyStore, parseConditions, recommend, updateFeedback, type HistoryEntry, type Profile, type Session } from './domain';
import { readStore, writeStore } from './storage';

type Page = 'home' | 'recommend' | 'onboard' | 'favorites' | 'history' | 'taste' | 'login';
type Step = 'input' | 'confirm' | 'results';
type Dialog = 'about' | 'account' | 'reset' | 'deleteHistory' | 'resetTaste' | null;
const toggle = (values: string[], value: string) => values.includes(value) ? values.filter(v => v !== value) : [...values, value];

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    ref.current?.querySelector<HTMLElement>('button, input')?.focus();
    const handle = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current();
      if (event.key === 'Tab') {
        const controls = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, a[href], select, textarea') ?? []);
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', handle);
    return () => { document.body.style.overflow = oldOverflow; document.removeEventListener('keydown', handle); previous?.focus(); };
  }, []);
  return <div className="modal-backdrop" onClick={onClose}><div ref={ref} className="modal" role="dialog" aria-modal="true" aria-labelledby="dialog-title" onClick={e => e.stopPropagation()}><button className="icon-button modal-close" aria-label="닫기" onClick={onClose}><X size={20} /></button><h2 id="dialog-title">{title}</h2>{children}</div></div>;
}

function HeroArt() {
  return <div className="hero-art" aria-hidden="true"><svg viewBox="0 0 470 340" fill="none">
    <ellipse cx="238" cy="302" rx="165" ry="19" fill="#dfd9c7" opacity=".4" />
    <rect x="307" y="39" width="95" height="129" rx="16" transform="rotate(14 307 39)" fill="#a4b2a4" />
    <circle cx="345" cy="100" r="29" fill="#344b42" /><circle cx="345" cy="100" r="10" fill="#f7d898" /><circle cx="345" cy="100" r="3" fill="#344b42" />
    <path d="M322 138h43m-41 8h29" stroke="#f7f6ee" strokeWidth="4" strokeLinecap="round" />
    <circle cx="219" cy="181" r="115" fill="#e7e6da" /><circle cx="219" cy="174" r="115" fill="#fffdf4" /><circle cx="219" cy="174" r="93" stroke="#eae6d6" strokeWidth="2" />
    <path d="M146 153c9-38 57-54 95-34 24 12 40 44 30 67-11 24-53 36-85 20-25-12-49-25-40-53Z" fill="#e6bc72" />
    <path d="M162 150c20-23 62-24 86-2m-88 15c21-18 52-19 74-3m-55 22c16-8 30-8 48-3" stroke="#f8e5b8" strokeWidth="8" strokeLinecap="round" />
    <path d="M151 186c-14-29-37-9-23 11-21 7-10 32 13 20-6 23 21 28 26 5 22 10 32-15 12-24 16-19-5-37-18-15" fill="#79966a" />
    <path d="M151 193l7 21m-7-18-11 6m15 5 14-6" stroke="#b8c39b" strokeWidth="3" strokeLinecap="round" />
    <circle cx="268" cy="189" r="17" fill="#de7354" /><circle cx="252" cy="213" r="15" fill="#e8845a" /><path d="m259 178 8 5 8-5m-30 26 7 5 8-3" stroke="#6d865a" strokeWidth="4" strokeLinecap="round" />
    <ellipse cx="197" cy="131" rx="21" ry="13" fill="#fef5dd" transform="rotate(-25 197 131)" /><ellipse cx="197" cy="131" rx="10" ry="7" fill="#e4b953" transform="rotate(-25 197 131)" />
    <path d="M343 213c-12-13-6-36 13-43 27-10 49 3 50 25" stroke="#526b5c" strokeWidth="12" strokeLinecap="round" />
    <rect x="331" y="205" width="18" height="42" rx="9" transform="rotate(-20 331 205)" fill="#526b5c" /><rect x="394" y="187" width="18" height="42" rx="9" transform="rotate(-20 394 187)" fill="#526b5c" />
    <path d="m365 267 3-36 15-5v32m-15-27 15-5" stroke="#d99257" strokeWidth="5" strokeLinecap="round" /><ellipse cx="360" cy="267" rx="8" ry="6" fill="#d99257" /><ellipse cx="376" cy="258" rx="8" ry="6" fill="#d99257" />
    <path d="m112 68 4 11 11 4-11 4-4 11-4-11-11-4 11-4Z" fill="#e5ae68" /><circle cx="288" cy="38" r="4" fill="#d6a576" />
    <path d="M83 129 59 246m32-115L67 248" stroke="#b68858" strokeWidth="5" strokeLinecap="round" />
  </svg><div className="art-label art-label-food"><Utensils size={13} /> 내 입맛에 맞게</div><div className="art-label art-label-music"><Music2 size={13} /> 내 리듬에 맞게</div></div>;
}

export default function App() {
  const [store, setStore] = useState(readStore);
  const [page, setPage] = useState<Page>('home');
  const [category, setCategory] = useState<Category>('food');
  const [step, setStep] = useState<Step>('input');
  const [session, setSession] = useState<Session>({ category: 'food', raw: '', conditions: emptyConditions(), excludedIds: [], revision: 0 });
  const [draftProfile, setDraftProfile] = useState<Profile>(store.profiles.food);
  const [query, setQuery] = useState('');
  const [onboardSummary, setOnboardSummary] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);
  const [filter, setFilter] = useState<'all' | Category>('all');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [feedbackItem, setFeedbackItem] = useState<Item | null>(null);
  const [historyPreview, setHistoryPreview] = useState<HistoryEntry | null>(null);
  const [deleteId, setDeleteId] = useState('');
  const [nameDraft, setNameDraft] = useState(store.name);
  const [busy, setBusy] = useState(false);
  const [requestError, setRequestError] = useState(false);
  const [failNext, setFailNext] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [toast, setToast] = useState<{ message: string; undo?: () => void } | null>(null);
  const [storageWarning, setStorageWarning] = useState(false);
  const requestCounter = useRef(0);
  const previousPage = useRef(page);
  const results = useMemo(() => recommend(session, store.profiles[session.category]), [session, store.profiles]);

  useEffect(() => { setStorageWarning(!writeStore(store)); }, [store]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(null), 6500); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => { if (previousPage.current !== page) { window.scrollTo({ top: 0, behavior: 'instant' }); previousPage.current = page; } }, [page]);
  useEffect(() => () => { requestCounter.current++; }, []);

  const notify = (message: string, undo?: () => void) => setToast({ message, undo });
  function navigate(next: Page) { requestCounter.current++; setBusy(false); setRequestError(false); setToast(null); setPage(next); setMobileNav(false); setQuery(''); setFilter('all'); }
  function backStep() { requestCounter.current++; setBusy(false); setRequestError(false); if (step === 'input') navigate('home'); else setStep(step === 'results' ? 'confirm' : 'input'); }
  function start(next: Category, raw = '') {
    requestCounter.current++; setBusy(false); setRequestError(false); setToast(null); setMobileNav(false); setQuery('');
    setCategory(next); setStep('input'); setSession({ category: next, raw, conditions: parseConditions(raw, next), excludedIds: [], revision: 0 });
    if (store.profiles[next].selected.length < 5) { setDraftProfile(store.profiles[next]); setEditingProfile(false); setOnboardSummary(false); setPage('onboard'); }
    else setPage('recommend');
  }
  function editTaste(next: Category) { setCategory(next); setDraftProfile(store.profiles[next]); setEditingProfile(true); setOnboardSummary(false); setQuery(''); navigate('onboard'); }
  function saveProfile() {
    setStore(s => ({ ...s, profiles: { ...s.profiles, [category]: draftProfile } }));
    if (editingProfile) navigate('taste'); else setPage('recommend');
    notify('내 취향을 저장했어요. 이제 지금의 상황을 알려주세요.');
  }
  function conditionTag(value: string, excluded = false) {
    setSession(s => ({ ...s, revision: 0, conditions: { ...s.conditions,
      tags: excluded ? s.conditions.tags.filter(t => t !== value) : toggle(s.conditions.tags, value),
      excluded: excluded ? toggle(s.conditions.excluded, value) : s.conditions.excluded.filter(t => t !== value) } }));
  }
  function favorite(id: string) { const saved = store.favorites.includes(id); setStore(s => ({ ...s, favorites: toggle(s.favorites, id) })); notify(saved ? '즐겨찾기에서 해제했어요.' : '즐겨찾기에 저장했어요.'); }
  function record(current: Session) {
    const recommended = recommend(current, store.profiles[current.category]);
    const entry: HistoryEntry = { id: crypto.randomUUID(), date: new Date().toISOString(), category: current.category, raw: current.raw || '직접 선택한 조건', conditions: structuredClone(current.conditions), resultIds: recommended.map(r => r.item.id) };
    setStore(s => ({ ...s, history: [entry, ...s.history].slice(0, 50) }));
  }
  async function run(again = false) {
    const current = again ? { ...session, revision: session.revision + 1 } : session;
    const token = ++requestCounter.current;
    setBusy(true); setRequestError(false);
    await new Promise(resolve => setTimeout(resolve, 550));
    if (token !== requestCounter.current) return;
    setBusy(false);
    if (failNext) { setFailNext(false); setRequestError(true); return; }
    setSession(current); record(current); setStep('results');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function applyFeedback(scope: 'session' | 'long') {
    if (!feedbackItem) return;
    const id = feedbackItem.id;
    const next = updateFeedback(store.profiles[category], session, id, scope);
    setStore(s => ({ ...s, profiles: { ...s.profiles, [category]: next.profile } }));
    setSession(next.session); setFeedbackItem(null);
    notify(scope === 'session' ? '이번 추천에서 제외했어요. 새 요청에서는 다시 추천될 수 있어요.' : '장기 비선호에 추가했어요. 다음 추천에도 반영할게요.', () => {
      if (scope === 'long') setStore(s => ({ ...s, profiles: { ...s.profiles, [category]: { ...s.profiles[category], disliked: s.profiles[category].disliked.filter(v => v !== id) } } }));
      else setSession(s => ({ ...s, excludedIds: s.excludedIds.filter(v => v !== id) }));
    });
  }
  function reuse(entry: HistoryEntry) { setHistoryPreview(null); start(entry.category, entry.raw); setSession({ category: entry.category, raw: entry.raw, conditions: structuredClone(entry.conditions), excludedIds: [], revision: 0 }); }

  const pageTitle: Record<Page, string> = { home: '홈', recommend: `${categoryLabel[category]} 추천`, onboard: editingProfile ? '취향 편집' : '첫 취향 등록', favorites: '즐겨찾기', history: '추천 기록', taste: '내 취향', login: '체험 시작' };
  const navItems = [{ page: 'home' as Page, label: '홈', icon: House }, { page: 'recommend' as Page, category: 'food' as Category, label: '음식 추천', icon: Utensils }, { page: 'recommend' as Page, category: 'music' as Category, label: '음악 추천', icon: Headphones }];
  const myItems = [{ page: 'favorites' as Page, label: '즐겨찾기', icon: Heart }, { page: 'history' as Page, label: '추천 기록', icon: Clock3 }, { page: 'taste' as Page, label: '내 취향', icon: SlidersHorizontal }];
  const chips = (values: string[], selected: string[], onClick: (v: string) => void, kind = '') => <div className="chips">{values.map(v => <button key={v} className={`chip ${kind} ${selected.includes(v) ? 'selected' : ''}`} aria-pressed={selected.includes(v)} onClick={() => onClick(v)}>{selected.includes(v) && <Check size={13} />}{v}</button>)}</div>;
  const tabFilter = <div className="filter-tabs" role="group" aria-label="분야 필터">{(['all', 'food', 'music'] as const).map(f => <button key={f} aria-pressed={filter === f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>{f === 'all' ? '전체' : categoryLabel[f]}</button>)}</div>;
  const itemCard = (item: Item, reasons?: { tasteReason: string; contextReason: string }) => <article className={`item-card ${item.category}`} key={item.id}>
    <div className="item-art" style={{ background: item.color }}><span>{item.emoji}</span><button className={`save-button ${store.favorites.includes(item.id) ? 'saved' : ''}`} aria-label={`${item.name} ${store.favorites.includes(item.id) ? '저장 해제' : '저장'}`} aria-pressed={store.favorites.includes(item.id)} onClick={() => favorite(item.id)}><Heart size={18} fill={store.favorites.includes(item.id) ? 'currentColor' : 'none'} /></button><span className="art-type">{item.category === 'food' ? 'MENU PICK' : 'MUSIC PICK'}</span></div>
    <div className="item-body"><div className="item-title"><h3>{item.name}</h3>{item.category === 'music' && <a className="icon-button" href={`https://www.youtube.com/results?search_query=${encodeURIComponent(item.subtitle + ' ' + item.name)}`} target="_blank" rel="noopener noreferrer" aria-label={`${item.name} 외부 감상 링크`}><ArrowRight size={18} /></a>}</div><p className="item-subtitle">{item.subtitle}{item.category === 'food' && <span> · 참고 가격</span>}</p><div className="mini-tags">{item.tags.slice(0, 3).map(t => <span key={t}>{t}</span>)}</div>
      {reasons ? <div className="reasons"><p><Heart size={13} /><b>평소</b> {reasons.tasteReason}</p><p><Sparkles size={13} /><b>지금</b> {reasons.contextReason}</p></div> : <p className="item-description">{item.description}</p>}
      {reasons && <button className="feedback-button" onClick={() => setFeedbackItem(item)}>다른 게 좋아요 <ChevronRight size={14} /></button>}
    </div></article>;

  return <div className="app-shell">
    {mobileNav && <button className="nav-backdrop" aria-label="메뉴 닫기" onClick={() => setMobileNav(false)} />}
    <aside className={`sidebar ${mobileNav ? 'open' : ''}`}>
      <button className="brand" onClick={() => navigate('home')} aria-label="지금 추천 홈"><span className="brand-mark"><Sparkles size={21} fill="currentColor" /></span><span>지금 추천<span className="brand-dot">.</span></span></button>
      <p className="brand-subtitle">오늘의 선택을 더 쉽게</p>
      <div className="nav-group"><span className="nav-caption">DISCOVER</span>{navItems.map(n => <button key={n.label} className={`nav-link ${page === n.page && (!n.category || category === n.category) ? 'active' : ''}`} onClick={() => n.category ? start(n.category) : navigate(n.page)}><n.icon size={19} /><span>{n.label}</span>{page === n.page && (!n.category || category === n.category) && <span className="nav-active-dot" />}</button>)}</div>
      <div className="nav-group"><span className="nav-caption">MY COLLECTION</span>{myItems.map(n => <button key={n.label} className={`nav-link ${page === n.page ? 'active' : ''}`} onClick={() => navigate(n.page)}><n.icon size={19} /><span>{n.label}</span>{n.page === 'favorites' && store.favorites.length > 0 && <span className="nav-count">{store.favorites.length}</span>}</button>)}</div>
      <div className="sidebar-bottom"><div className="sidebar-note"><Leaf size={22} /><strong>취향은 그대로,<br />오늘은 오늘답게.</strong><p>지금의 기분이 바뀌어도<br />평소 취향은 지켜드릴게요.</p></div><button className="help-link" onClick={() => setDialog('about')}><Info size={16} /> 체험 안내 <ArrowRight size={14} /></button><button className="user-panel" onClick={() => { setNameDraft(store.name); setDialog('account'); }}><span className="avatar">{store.name.slice(0, 1)}</span><span><b>{store.name}</b><small>나만의 취향을 발견하는 중</small></span><Settings2 size={16} /></button></div>
    </aside>
    <div className="workspace"><header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" aria-label="메뉴 열기" onClick={() => setMobileNav(true)}><Menu size={21} /></button><span>나의 오늘</span><ChevronRight size={13} /><b>{pageTitle[page]}</b></div><div className="topbar-right"><span className="demo-badge"><span /> 체험 버전</span><button className="top-avatar" aria-label="내 계정" onClick={() => { setNameDraft(store.name); setDialog('account'); }}>{store.name.slice(0, 1)}</button></div></header>
      <main id="main-content" className={`main-content ${page}`}>
      {storageWarning && <div className="notice warning">이 브라우저에서는 저장할 수 없어요. 지금 체험은 가능하지만 새로고침하면 변경 내용이 사라질 수 있어요.</div>}
      {page === 'home' && <>
        <div className="welcome"><div><p className="eyebrow">A LITTLE MORE YOU</p><h1>오늘도, 나에게 맞는 선택.</h1><p>무엇을 먹을지, 무엇을 들을지. 지금의 나에게 물어보세요.</p></div><span className="date-label">{new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'long', timeZone: 'Asia/Seoul' }).format(new Date())}</span></div>
        <section className="hero"><div className="hero-copy"><span className="hero-kicker"><span /> 평소 취향 + 지금의 기분</span><h2>오늘의 선택,<br />지금의 <span>나답게.</span></h2><p>익숙한 취향에 오늘의 상황을 더해<br />당신에게 어울리는 음식과 음악을 찾아요.</p><button className="button primary" onClick={() => start('food')}>나에게 맞는 추천 시작 <ArrowRight size={17} /></button><div className="hero-footnote"><ShieldCheck size={14} /> 평소 취향과 오늘의 조건을 따로 기억해요</div></div><HeroArt /></section>
        <section className="discover-section"><div className="section-heading"><h2>지금, 무엇이 필요하세요?</h2><span>마음이 가는 쪽부터 시작해요</span></div><div className="category-grid"><button className="category-card food-category" onClick={() => start('food')}><div className="category-icon"><Utensils size={23} /></div><div className="category-copy"><span className="eyebrow">SOMETHING TO EAT</span><h3>오늘 뭐 먹지?</h3><p>입맛과 상황에 딱 맞는 한 끼를 찾아요.</p><span className="category-link">음식 추천받기 <ArrowRight size={16} /></span></div><span className="category-emoji">🍜</span></button><button className="category-card music-category" onClick={() => start('music')}><div className="category-icon"><Headphones size={23} /></div><div className="category-copy"><span className="eyebrow">SOMETHING TO LISTEN</span><h3>지금 뭐 듣지?</h3><p>지금의 기분에 어울리는 리듬을 찾아요.</p><span className="category-link">음악 추천받기 <ArrowRight size={16} /></span></div><span className="category-emoji">🎧</span></button></div></section>
        <div className="home-bottom-grid"><section className="taste-overview"><div className="section-heading"><h2><SlidersHorizontal size={17} /> 내 취향 한눈에</h2><button className="text-button" onClick={() => navigate('taste')}>관리하기 <ArrowRight size={14} /></button></div>{(['food', 'music'] as Category[]).map(c => <div className="taste-overview-row" key={c}><span className={`small-icon ${c}`}>{c === 'food' ? <Utensils size={16} /> : <Music2 size={16} />}</span><div><b>{categoryLabel[c]} 취향</b><p>{store.profiles[c].selected.length >= 5 ? (store.profiles[c].tags.slice(0, 3).join(' · ') || store.profiles[c].selected.slice(0, 3).map(id => items.find(i => i.id === id)?.name).join(' · ')) : '좋아하는 것부터 알려주세요'}</p></div><button className="status-chip" onClick={() => editTaste(c)}>{store.profiles[c].selected.length >= 5 ? '등록 완료' : '등록하기'}<ChevronRight size={12} /></button></div>)}</section><section className="inspiration"><span className="eyebrow">TRY A LITTLE INSPIRATION</span><h3>이렇게 시작해보세요</h3><button onClick={() => start('food', '혼자 먹을 담백한 저녁이 먹고 싶어')}><span>“혼자 먹을 담백한 저녁이 먹고 싶어”</span><ArrowRight size={16} /></button><button onClick={() => start('music', '과제하면서 들을 차분한 연주곡')}><span>“과제하면서 들을 차분한 연주곡”</span><ArrowRight size={16} /></button></section></div>
      </>}

      {page === 'onboard' && <>
        <button className="back-link" onClick={() => navigate(editingProfile ? 'taste' : 'home')}><ArrowLeft size={15} /> {editingProfile ? '내 취향으로' : '홈으로'}</button><div className="page-heading"><p className="eyebrow">GET TO KNOW YOU · {category === 'food' ? 'FOOD' : 'MUSIC'}</p><h1>{onboardSummary ? '이 취향으로 시작할까요?' : `평소 좋아하는 ${category === 'food' ? '음식을' : '음악을'} 골라주세요.`}</h1><p>{onboardSummary ? '선택한 항목과 선호 이유를 확인해주세요. 언제든 다시 바꿀 수 있어요.' : '5개 이상 골라주세요. 오늘의 기분보다 평소 좋아하는 것을 떠올려보세요.'}</p></div>
        <div className="onboard-layout"><section className="panel selection-panel">{!onboardSummary ? <><label className="search-field"><Search size={18} /><input aria-label="취향 항목 검색" placeholder={category === 'food' ? '메뉴 이름 검색' : '곡명 또는 아티스트 검색'} value={query} onChange={e => setQuery(e.target.value)} /></label><div className="selection-grid">{items.filter(i => i.category === category && `${i.name} ${i.subtitle}`.toLowerCase().includes(query.toLowerCase())).map(i => <button key={i.id} className={`selection-card ${draftProfile.selected.includes(i.id) ? 'selected' : ''}`} aria-pressed={draftProfile.selected.includes(i.id)} onClick={() => setDraftProfile(p => ({ ...p, selected: toggle(p.selected, i.id), disliked: p.disliked.filter(id => id !== i.id) }))}><span className="selection-emoji" style={{ background: i.color }}>{i.emoji}</span><b>{i.name}</b>{category === 'music' && <small>{i.subtitle}</small>}<span className="selection-check">{draftProfile.selected.includes(i.id) ? <Check size={14} /> : <Plus size={14} />}</span></button>)}</div>{!items.some(i => i.category === category && `${i.name} ${i.subtitle}`.toLowerCase().includes(query.toLowerCase())) && <p className="empty-small">검색 결과가 없어요. 다른 이름으로 찾아보세요.</p>}</> : <><h2>좋아하는 {categoryLabel[category]}</h2><div className="summary-items">{draftProfile.selected.map(id => items.find(i => i.id === id)).filter((i): i is Item => !!i).map(i => <span key={i.id}>{i.emoji} {i.name}</span>)}</div><h2>좋아하는 이유</h2><p>{draftProfile.tags.join(' · ') || '선택한 항목을 바탕으로 취향을 참고할게요.'}</p><div className="notice"><ShieldCheck size={18} /> 음식과 음악의 취향은 각각 따로 저장해요.</div></>}</section><aside className="panel selection-summary"><span className="step-small">{onboardSummary ? '02' : '01'} / 02</span><h3>조금씩 알아갈게요.</h3><p>많이 고민하지 않아도 괜찮아요.<br />좋아하는 것부터 시작하면 돼요.</p><div className="selection-progress"><strong>{draftProfile.selected.length}<small> / 최소 5개</small></strong><div><span style={{ width: `${Math.min(draftProfile.selected.length / 5, 1) * 100}%` }} /></div></div><h4>어떤 점이 좋아요? <small>선택 사항</small></h4>{chips(options[category].filter(t => !['혼자', '함께', '점심', '저녁', '과제', '운동', '산책', '휴식'].includes(t)), draftProfile.tags, v => setDraftProfile(p => ({ ...p, tags: toggle(p.tags, v) })))}<button className="button primary full-width" disabled={draftProfile.selected.length < 5} onClick={() => onboardSummary ? saveProfile() : setOnboardSummary(true)}>{onboardSummary ? '확인하고 저장' : '취향 요약 확인'}<ArrowRight size={16} /></button>{onboardSummary && <button className="text-button centered" onClick={() => setOnboardSummary(false)}>다시 고르기</button>}</aside></div>
      </>}

      {page === 'recommend' && <>
        <div className="recommend-top"><button className="back-link" onClick={backStep}><ArrowLeft size={15} /> {step === 'input' ? '홈으로' : '이전 단계'}</button><div className="stepper">{['상황 입력', '조건 확인', '추천 결과'].map((label, index) => { const current = ['input', 'confirm', 'results'].indexOf(step); return <span key={label} className={current === index ? 'current' : current > index ? 'done' : ''}><i>{current > index ? <Check size={11} /> : index + 1}</i>{label}{index < 2 && <ChevronRight size={12} />}</span>; })}</div></div>
        <div className="page-heading"><p className={`eyebrow ${category}`}>{category === 'food' ? 'A MEAL FOR YOUR MOMENT' : 'A SOUNDTRACK FOR YOUR MOMENT'}</p><h1>{step === 'input' ? (category === 'food' ? '지금, 어떤 한 끼가 필요하세요?' : '지금, 어떤 음악이 필요하세요?') : step === 'confirm' ? '이렇게 이해했어요.' : '지금의 당신을 위한 추천.'}</h1><p>{step === 'input' ? '오늘의 상황을 편하게 적어주세요. 선택 항목만 골라도 괜찮아요.' : step === 'confirm' ? '추천 전에 한 번만 확인해주세요. 조건을 더하거나 지울 수 있어요.' : '평소 취향에 지금의 조건을 더했어요. 마음에 드는 선택을 발견해보세요.'}</p></div>
        {step !== 'results' ? <div className="composer-layout"><section className="panel composer">
          {step === 'input' ? <><label className="field-title" htmlFor="situation">지금의 상황 <span>자유롭게 적어주세요</span></label><textarea id="situation" maxLength={300} value={session.raw} onChange={e => setSession(s => ({ ...s, raw: e.target.value }))} placeholder={category === 'food' ? '예: 혼자 먹을 담백하고 따뜻한 저녁이 먹고 싶어' : '예: 과제하면서 들을 차분한 연주곡을 추천해줘'} /><div className="textarea-caption"><span>일상적인 문장으로 시작해보세요</span><span>{session.raw.length}/300</span></div><div className="example-row"><span>예를 들면</span>{(category === 'food' ? ['혼자 먹을 담백한 저녁', '매콤한 점심, 만원 이하'] : ['과제할 때 듣는 연주곡', '산책할 때 활기찬 음악']).map(text => <button key={text} onClick={() => setSession(s => ({ ...s, raw: text, conditions: parseConditions(text, category) }))}>{text}<Plus size={12} /></button>)}</div><div className="form-divider" /><h3>원하는 조건 <small>선택 사항</small></h3>{chips(options[category], session.conditions.tags, v => conditionTag(v))}</> : <><div className="quote-box"><span>내가 입력한 상황</span><p>“{session.raw || '직접 선택한 조건으로 추천받기'}”</p></div><h3>이번 요청에 반영할 조건</h3><p className="form-description">선택한 조건을 누르면 해제돼요. 빠진 조건은 아래에서 추가하세요.</p>{session.conditions.tags.length ? <div className="chips">{session.conditions.tags.map(t => <button className="chip selected" key={t} onClick={() => conditionTag(t)} aria-label={`${t} 조건 삭제`}>{t}<X size={13} /></button>)}</div> : <div className="empty-small">선호 조건이 없어요. 평소 취향을 중심으로 추천할게요.</div>}<details className="add-conditions"><summary><Plus size={15} /> 조건 추가하기</summary>{chips(options[category].filter(t => !session.conditions.tags.includes(t)), [], v => conditionTag(v))}</details><div className="form-divider" /></>}
          <h3><ShieldCheck size={17} /> 반드시 제외할 항목 <small>선호 조건보다 먼저 적용해요</small></h3>{chips(exclusions[category], session.conditions.excluded, v => conditionTag(v, true), 'exclude')}
          {category === 'food' && <label className="budget-field">참고 가격대<select aria-label="참고 가격대" value={session.conditions.maxPrice ?? ''} onChange={e => setSession(s => ({ ...s, conditions: { ...s.conditions, maxPrice: e.target.value ? Number(e.target.value) : null } }))}><option value="">제한 없음</option><option value="10000">10,000원 이하</option><option value="15000">15,000원 이하</option><option value="20000">20,000원 이하</option></select></label>}
          {requestError && <div className="error-box" role="alert"><strong>조건 확인을 잠시 완료하지 못했어요.</strong><p>다시 시도하거나, 지금 직접 고른 조건으로 추천받을 수 있어요.</p><button className="text-button" onClick={() => { record(session); setStep('results'); setRequestError(false); }}>직접 선택한 조건으로 계속 <ArrowRight size={14} /></button></div>}
          <div className="form-actions"><span><ShieldCheck size={14} /> 오늘의 조건은 평소 취향을 바꾸지 않아요</span><button className="button primary" disabled={busy} onClick={() => { if (step === 'input') { const parsed = parseConditions(session.raw, category); setSession(s => ({ ...s, conditions: { tags: [...new Set([...s.conditions.tags, ...parsed.tags])].filter(t => ![...s.conditions.excluded, ...parsed.excluded].includes(t)), excluded: [...new Set([...s.conditions.excluded, ...parsed.excluded])], maxPrice: s.conditions.maxPrice ?? parsed.maxPrice } })); setStep('confirm'); } else run(); }}>{busy ? <span className="spinner" /> : <Sparkles size={16} />}{busy ? '추천을 고르는 중' : step === 'input' ? '조건 확인하기' : requestError ? '다시 시도하기' : '추천받기'}{!busy && <ArrowRight size={15} />}</button></div>
        </section><aside className="context-sidebar"><div className="panel context-profile"><span className={`small-icon ${category}`}>{category === 'food' ? <Utensils size={19} /> : <Headphones size={19} />}</span><h3>평소의 나는</h3><p>오늘의 요청과 따로 기억하고 있어요.</p><div className="mini-tags">{store.profiles[category].tags.map(t => <span key={t}>{t}</span>)}</div><div className="profile-picked">{store.profiles[category].selected.slice(0, 5).map(id => { const i = items.find(i => i.id === id); return i ? <span key={id}>{i.emoji} {i.name}</span> : null; })}</div><button className="text-button" onClick={() => editTaste(category)}>취향 수정 <ArrowRight size={14} /></button></div><div className="gentle-tip"><Leaf size={20} /><h4>오늘은 달라도 괜찮아요.</h4><p>평소 매운 음식을 좋아해도<br />오늘은 담백한 한 끼를 고를 수 있죠.<br />지금의 선택에 집중해보세요.</p></div></aside></div> : <>
          <div className="result-summary"><div><span className="summary-label">이번 요청</span><strong>{session.raw || '직접 선택한 조건'}</strong><div className="mini-tags">{session.conditions.tags.map(t => <span key={t}>{t}</span>)}{session.conditions.excluded.map(t => <span className="excluded-tag" key={t}>{t} 제외</span>)}{session.conditions.maxPrice !== null && <span>{session.conditions.maxPrice.toLocaleString()}원 이하</span>}</div></div><button className="button secondary" disabled={busy} onClick={() => { setStep('confirm'); setRequestError(false); }}><SlidersHorizontal size={15} /> 조건 수정</button></div>
          <div className="section-heading result-heading"><h2>{category === 'food' ? '오늘의 메뉴' : '오늘의 플레이리스트'} <span className="count">{results.length}</span></h2><span>{category === 'food' ? '당신을 위한 세 가지 선택' : '당신의 하루에 어울리는 다섯 곡'}</span></div>
          {results.length < (category === 'food' ? 3 : 5) && <div className="notice warning"><Info size={18} /><div><strong>{results.length ? '조건에 맞는 후보가 조금 부족해요.' : '지금 조건에 맞는 후보가 없어요.'}</strong><p>제외 항목{session.conditions.excluded.length ? ` (${session.conditions.excluded.join(', ')})` : ''}, 가격대 또는 비선호 항목을 확인해주세요. 조건은 자동으로 완화하지 않아요.</p><button className="text-button" onClick={() => setStep('confirm')}>조건 조정하기 <ArrowRight size={14} /></button></div></div>}
          <div className={`result-grid ${category}`}>{results.map(r => itemCard(r.item, r))}</div>
          {requestError && <div className="error-box" role="alert">재추천을 완료하지 못했어요. 아래 버튼으로 다시 시도해주세요.</div>}
          <div className="reroll-panel"><div><span className="small-icon"><Sparkles size={20} /></span><div><h3>조금 다른 선택도 궁금한가요?</h3><p>지금의 조건을 유지하고 다른 후보를 살펴보세요.</p></div></div><button className="button secondary" disabled={busy || results.length === 0} onClick={() => run(true)}>{busy ? <span className="spinner" /> : <Sparkles size={16} />}{busy ? '다른 추천을 고르는 중' : '다른 추천 보기'}</button></div>
          {session.excludedIds.length > 0 && <div className="temporary-exclusions"><span>이번 요청에서만 제외</span>{session.excludedIds.map(id => <button key={id} onClick={() => setSession(s => ({ ...s, excludedIds: s.excludedIds.filter(v => v !== id) }))}>{items.find(i => i.id === id)?.name}<X size={12} /></button>)}</div>}
          <div className="new-session-link"><button className="text-button" onClick={() => start(category)}>새로운 상황으로 추천받기 <ArrowRight size={15} /></button></div>
        </>}
      </>}

      {page === 'favorites' && <><div className="page-heading"><p className="eyebrow">KEEP WHAT YOU LOVE</p><h1>좋아하는 선택을 모아두었어요.</h1><p>다시 만나고 싶은 음식과 음악. 마음에 든 순간을 꺼내보세요.</p></div>{tabFilter}<div className="collection-grid">{items.filter(i => store.favorites.includes(i.id) && (filter === 'all' || i.category === filter)).map(i => itemCard(i))}</div>{!items.some(i => store.favorites.includes(i.id) && (filter === 'all' || i.category === filter)) && <div className="empty-state"><span><Heart size={30} /></span><h3>아직 저장한 {filter === 'all' ? '추천이' : `${categoryLabel[filter]}이`} 없어요.</h3><p>추천 카드의 하트를 누르면 여기에 모여요.</p><button className="button primary" onClick={() => start(filter === 'music' ? 'music' : 'food')}>취향에 맞는 추천 찾기 <ArrowRight size={16} /></button></div>}</>}
      {page === 'history' && <><div className="page-heading"><p className="eyebrow">YOUR LITTLE MOMENTS</p><h1>그날의 선택, 그때의 취향.</h1><p>지난 추천의 조건과 결과를 확인하고 같은 상황으로 다시 시작해보세요.</p></div>{tabFilter}<div className="history-list">{store.history.filter(h => filter === 'all' || h.category === filter).map(h => <article className="history-row" key={h.id}><span className={`small-icon ${h.category}`}>{h.category === 'food' ? <Utensils size={22} /> : <Headphones size={22} />}</span><div className="history-content"><span>{categoryLabel[h.category]} 추천 · {new Intl.DateTimeFormat('ko-KR', { month: 'short', day: 'numeric', hour: 'numeric', minute: 'numeric', timeZone: 'Asia/Seoul' }).format(new Date(h.date))}</span><button className="history-title" onClick={() => setHistoryPreview(h)}>{h.raw}</button><p>{h.resultIds.map(id => items.find(i => i.id === id)?.name).filter(Boolean).join(' · ') || '조건에 맞는 결과 없음'}</p></div><button className="button secondary compact" onClick={() => reuse(h)}>다시 추천 <ArrowRight size={14} /></button><button className="icon-button" aria-label={`${h.raw} 기록 삭제`} onClick={() => { setDeleteId(h.id); setDialog('deleteHistory'); }}><Trash2 size={16} /></button></article>)}</div>{!store.history.some(h => filter === 'all' || h.category === filter) && <div className="empty-state"><span><Clock3 size={30} /></span><h3>첫 번째 선택을 기다리고 있어요.</h3><p>추천받은 상황과 결과를 여기에서 다시 볼 수 있어요.</p><button className="button primary" onClick={() => start(filter === 'music' ? 'music' : 'food')}>추천 시작하기 <ArrowRight size={16} /></button></div>}</>}
      {page === 'taste' && <><div className="page-heading"><p className="eyebrow">THINGS THAT MAKE YOU, YOU</p><h1>내 취향은, 내가 정해요.</h1><p>평소 좋아하는 것과 원하지 않는 것을 따로 관리해요.</p></div><div className="taste-grid">{(['food', 'music'] as Category[]).map(c => <section className="panel taste-panel" key={c}><div className="section-heading"><h2><span className={`small-icon ${c}`}>{c === 'food' ? <Utensils size={18} /> : <Music2 size={18} />}</span>{categoryLabel[c]} 취향</h2><button className="text-button" onClick={() => editTaste(c)}>{store.profiles[c].selected.length >= 5 ? '편집하기' : '등록하기'}<ArrowRight size={14} /></button></div><h4>처음 고른 선호 항목</h4><div className="summary-items">{store.profiles[c].selected.map(id => { const i = items.find(i => i.id === id); return i ? <span key={id}>{i.emoji} {i.name}</span> : null; })}</div>{!store.profiles[c].selected.length && <p className="muted">아직 취향을 등록하지 않았어요.</p>}<div className="mini-tags">{store.profiles[c].tags.map(t => <span key={t}>{t}</span>)}</div><div className="form-divider" /><h4>피드백으로 추가한 장기 비선호 <span>{store.profiles[c].disliked.length}</span></h4><p className="form-description">개별 항목만 제외해요. 비슷한 메뉴나 장르까지 확대하지 않아요.</p><div className="chips">{store.profiles[c].disliked.map(id => <button className="chip exclude selected" key={id} aria-label={`${items.find(i => i.id === id)?.name} 비선호 해제`} onClick={() => { setStore(s => ({ ...s, profiles: { ...s.profiles, [c]: { ...s.profiles[c], disliked: s.profiles[c].disliked.filter(v => v !== id) } } })); notify('장기 비선호를 해제했어요.'); }}>{items.find(i => i.id === id)?.name}<X size={13} /></button>)}</div>{!store.profiles[c].disliked.length && <p className="muted small">등록된 장기 비선호가 없어요.</p>}<button className="text-button danger reset-taste" onClick={() => { setCategory(c); setDialog('resetTaste'); }}>이 분야 취향 초기화</button></section>)}</div><div className="notice"><ShieldCheck size={20} /><div><strong>‘오늘만 제외’는 내 취향에 남지 않아요.</strong><p>음식과 음악은 각각 독립적으로 기억해요. 다른 분야의 취향을 임의로 추측하지 않아요.</p></div></div></>}
      {page === 'login' && <div className="login-panel panel"><span className="brand-mark"><Sparkles size={26} /></span><p className="eyebrow">WELCOME TO YOUR MOMENT</p><h1>당신의 취향에서 시작해요.</h1><p>이름만 입력하고 체험을 이어가세요.<br />실제 회원가입 없이 화면 흐름을 살펴볼 수 있어요.</p><form onSubmit={e => { e.preventDefault(); setStore(s => ({ ...s, name: nameDraft.trim() || '취향 탐험가' })); navigate('home'); }}><label className="field-title" htmlFor="demo-name">체험 이름</label><input id="demo-name" required maxLength={16} placeholder="어떻게 불러드릴까요?" value={nameDraft} onChange={e => setNameDraft(e.target.value)} /><button className="button primary full-width">체험 시작하기 <ArrowRight size={17} /></button></form></div>}
      <footer className="footer"><span><Sparkles size={13} /> 지금 추천</span><span>평소의 나와, 지금의 나를 함께.</span><button onClick={() => setDialog('about')}>체험 안내</button></footer>
      </main>
    </div>
    {toast && <div className="toast" role="status"><CheckCheck size={18} /><span>{toast.message}</span>{toast.undo && <button onClick={() => { toast.undo?.(); setToast(null); }}>되돌리기</button>}<button className="icon-button" aria-label="알림 닫기" onClick={() => setToast(null)}><X size={15} /></button></div>}
    {feedbackItem && <Modal title="이 추천은 어떤 점이 아쉬웠나요?" onClose={() => setFeedbackItem(null)}><p className="modal-description"><b>{feedbackItem.name}</b>에 대한 의견을 어디까지 반영할지 골라주세요.</p><button className="feedback-option" onClick={() => applyFeedback('session')}><span className="small-icon food"><Clock3 size={21} /></span><span><b>오늘만 제외</b><small>이번 요청에서만 빼고 다른 항목을 추천해요.<br />새로운 상황으로 시작하면 다시 만날 수 있어요.</small></span><ChevronRight size={19} /></button><button className="feedback-option" onClick={() => applyFeedback('long')}><span className="small-icon music"><SlidersHorizontal size={21} /></span><span><b>원래 내 취향이 아님</b><small>이 항목을 장기 비선호에 저장해요.<br />다음 요청에서도 제외하며, 내 취향에서 해제할 수 있어요.</small></span><ChevronRight size={19} /></button><button className="button secondary full-width" onClick={() => setFeedbackItem(null)}>취소</button></Modal>}
    {historyPreview && <Modal title="그때의 추천" onClose={() => setHistoryPreview(null)}><p className="modal-description">{historyPreview.raw}</p><div className="mini-tags">{historyPreview.conditions.tags.map(t => <span key={t}>{t}</span>)}{historyPreview.conditions.excluded.map(t => <span key={t} className="excluded-tag">{t} 제외</span>)}{historyPreview.conditions.maxPrice !== null && <span>{historyPreview.conditions.maxPrice.toLocaleString()}원 이하</span>}</div><div className="preview-results">{historyPreview.resultIds.map(id => { const i = items.find(i => i.id === id); return i ? <div key={id}><span>{i.emoji}</span><div><b>{i.name}</b><small>{i.subtitle}</small></div></div> : null; })}</div><button className="button primary full-width" onClick={() => reuse(historyPreview)}>같은 조건으로 다시 추천 <ArrowRight size={16} /></button></Modal>}
    {dialog === 'about' && <Modal title="지금 추천을 먼저 경험해보세요." onClose={() => setDialog(null)}><p className="modal-description">취향 등록부터 조건 수정, 추천과 피드백까지 직접 사용해볼 수 있는 체험 버전이에요.</p><div className="about-list"><p><Check size={17} /> 음식 16개와 음악 15곡의 예시 데이터로 추천해요.</p><p><Check size={17} /> 문장의 알려진 표현을 조건으로 바꿔요. 실제 AI 연결 전이라 놓친 조건은 직접 수정해주세요.</p><p><Check size={17} /> 취향·즐겨찾기·최근 50개 기록은 이 브라우저에 저장해요.</p><p><Check size={17} /> 계정 인증과 실제 주문·음원 재생은 포함하지 않아요.</p></div><div className="demo-tools"><h4>실패 화면도 살펴볼까요?</h4><p>다음 추천 요청 한 번에 오류 안내를 표시해요. 재시도와 수동 진행을 확인할 수 있어요.</p><button className="button secondary full-width" onClick={() => { setFailNext(true); setDialog(null); notify('다음 추천 요청에서 실패 안내를 체험할 수 있어요.'); }}>다음 추천 실패 체험하기</button></div></Modal>}
    {dialog === 'account' && <Modal title="나의 체험 계정" onClose={() => setDialog(null)}><p className="modal-description">이 브라우저에서 사용할 이름을 바꿀 수 있어요.</p><form onSubmit={e => { e.preventDefault(); setStore(s => ({ ...s, name: nameDraft.trim() || '취향 탐험가' })); setDialog(null); notify('체험 이름을 변경했어요.'); }}><label className="field-title" htmlFor="account-name">이름</label><input id="account-name" value={nameDraft} maxLength={16} required onChange={e => setNameDraft(e.target.value)} /><button className="button primary full-width">변경 저장</button></form><div className="account-links"><button onClick={() => { setDialog(null); setNameDraft(store.name); navigate('login'); }}><LogOut size={17} /> 체험 나가기</button><button className="danger" onClick={() => setDialog('reset')}><Trash2 size={17} /> 체험 데이터 모두 초기화</button></div></Modal>}
    {['reset', 'deleteHistory', 'resetTaste'].includes(dialog || '') && <Modal title={dialog === 'reset' ? '체험 데이터를 초기화할까요?' : dialog === 'resetTaste' ? `${categoryLabel[category]} 취향을 초기화할까요?` : '이 추천 기록을 삭제할까요?'} onClose={() => setDialog(null)}><p className="modal-description">{dialog === 'reset' ? '이 브라우저의 취향, 즐겨찾기와 추천 기록을 모두 삭제해요.' : dialog === 'resetTaste' ? '이 분야의 선호 항목과 장기 비선호를 삭제해요. 즐겨찾기와 기록은 유지해요.' : '삭제한 기록은 복구할 수 없어요. 취향과 즐겨찾기는 유지해요.'}</p><div className="modal-actions"><button className="button secondary" onClick={() => setDialog(null)}>취소</button><button className="button danger-button" onClick={() => { if (dialog === 'reset') { setStore(emptyStore()); setSession({ category: 'food', raw: '', conditions: emptyConditions(), excludedIds: [], revision: 0 }); setToast(null); navigate('home'); } else if (dialog === 'resetTaste') { setStore(s => ({ ...s, profiles: { ...s.profiles, [category]: { selected: [], tags: [], disliked: [] } } })); } else setStore(s => ({ ...s, history: s.history.filter(h => h.id !== deleteId) })); setDialog(null); notify('삭제했어요.'); }}>삭제하기</button></div></Modal>}
  </div>;
}
