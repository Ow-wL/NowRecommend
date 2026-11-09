import { useEffect, useLayoutEffect, useMemo, useRef, useState, useReducer } from 'react';
import { applyAppearance } from './theme';
import { AppearanceSettings } from './components/AppearanceSettings';
import { ArrowLeft, ArrowRight, BookOpen, Check, CheckCheck, ChevronDown, ChevronRight, CircleDashed, Clock3, Cloud, CloudOff, CloudSun, Columns2, Headphones, Heart, House, Info, ListMusic, LogIn, LogOut, MapPin, Mic, PenLine, Play, CalendarDays, Sparkles, SmilePlus, RefreshCw, Search, Settings2, Share2, SlidersHorizontal, Square, ThumbsUp, Trash2, Utensils, X, Plus } from 'lucide-react';
import { options, exclusions, categoryLabel, type Category, type Item } from './data';
import { loadCatalog, useCatalog } from './catalog';
import { apiEnabled } from './api/client';
import { fetchRecommendations, qualityOf } from './api/recommend';
import { fetchParse } from './api/parse';
import { ParseNotice } from './components/ParseNotice';
import { LoadingResults } from './components/LoadingResults';
import { ReviewForm } from './components/ReviewForm';
import { QualityNotice } from './components/QualityNotice';
import { emptyStore, yearLabel, presetKey, presetLabel, parseConditions, unsupportedConditions, createEditor, changeText, applyParsed, toggleCondition, conditionConflicts, conditionChecks, cleanConditions, eligibleCandidates, recommend, nextBatch, applyBatch, replaceCandidate, replacementRequest, canReplace, applyReplacement, candidateInfo, updateFeedback, type HistoryEntry, type Profile, type Session, type Recommendation, type Feedback, type Preset, type YearRange, type Store } from './domain';
import { ConditionNotes } from './components/ConditionNotes';
import { Comparison } from './components/Comparison';
import { Lab } from './components/Lab';
import { ItemArt } from './components/ItemArt';
import { mapSearch, mediaFor, recipeSearch, songLink, youtubeSearch } from './media';
import { applyPreset } from './presets';
import { momentPreset, slotLabel, timeSlot } from './moment';
import { useVoiceInput } from './voice';
import { applySuggestion, typoSuggestions } from './typo';
import { conditionLabels, shareResults, shareText, appAddress, type ShareInput } from './share';
import { stopPreview } from './preview';
import { computeStats, slotSentence } from './stats';
import { dayLabel, matchesHistory, monthOf, seoulDay } from './calendar';
import { HistoryCalendar } from './components/HistoryCalendar';
import { ManualRecord } from './components/ManualRecord';
import { PreviewButton } from './components/PreviewButton';
import { Playlist } from './components/Playlist';
import { clearWeather, readWeather, requestWeather, weatherLabel, type Weather } from './weather';
import { Presets, ConditionsSummary } from './components/Presets';
import { Favorites } from './components/Favorites';
import { ItemDetails } from './components/ItemDetails';
import { AdminReports } from './components/AdminReports';
import { ReportDialog } from './components/ReportDialog';
import { TasteReasons } from './components/TasteReasons';
import { TasteType } from './components/TasteType';
import { requestForType } from './tasteType';
import type { SongStatus } from './songCheck';
import { readStoreResult, writeStore, replaceStore, downloadRecovery, clearDamagedStore } from './storage';
import { DataManagement } from './components/DataManagement';
import { recordRound, selectResult,reviewSelection, addManual, MANUAL_RAW } from './history';
import { HistoryDetails } from './components/HistoryDetails';
import { Modal } from './components/Modal';
import { RecommendationCard } from './components/RecommendationCard';
import { navigationDirection, parseRoute, routeFor, viewReducer, type Page, type Step, type View } from './navigation';
import { newSession, readTab, writeTab } from './sessionStorage';
import { isAiPick, rememberItems, resolveItem } from './knownItems';
import { keepLocalCopy, mergeOnLogin, readAccount, writeAccount, type Account } from './account';
import { fetchMe, deleteAccount, fetchRemoteStore, pushRemoteStore, type AuthSession } from './api/auth';
import { ApiError } from './api/client';
import { AuthPanel } from './components/AuthPanel';

type Dialog = 'about' | 'account' | 'reset' | 'deleteHistory' | 'resetTaste' | 'deleteAccount' | null;
const hasTaste = (p: Profile) => p.selected.length > 0 || p.tags.length > 0 || !!p.custom?.length;
/** Today, yesterday and each earlier date, newest first, in Korean time. */
function historyGroups(entries: HistoryEntry[]): [string, HistoryEntry[]][] {
  const day = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
  const today = day(new Date()), yesterday = day(new Date(Date.now() - 86400000));
  const groups = new Map<string, HistoryEntry[]>();
  for (const entry of entries) {
    const date = new Date(entry.date), key = day(date);
    const label = key === today ? '오늘' : key === yesterday ? '어제' : new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', timeZone: 'Asia/Seoul' }).format(date);
    groups.set(label, [...(groups.get(label) || []), entry]);
  }
  return [...groups];
}
const toggle = (values: string[], value: string) => values.includes(value) ? values.filter(v => v !== value) : [...values, value];

export default function App() {
  const [loaded] = useState(readStoreResult);
  const catalog = useCatalog();
  const { items } = catalog;
  useEffect(() => { void loadCatalog(); }, []);
  const [store, setStore] = useState(loaded.store);
  useLayoutEffect(()=>{const apply=()=>applyAppearance(store.appearance);apply();const media=window.matchMedia('(prefers-color-scheme:dark)');if(store.appearance?.mode!=='system')return;media.addEventListener('change',apply);return ()=>media.removeEventListener('change',apply);},[store.appearance]);
  const [storageBlocked, setStorageBlocked] = useState(loaded.issue === 'damaged');
  const [initial] = useState(readTab);
  const [view, dispatchView] = useReducer(viewReducer, { ...initial.view, ...parseRoute(window.location.hash), step: /#\/(recommend|onboard)\//.test(window.location.hash) ? parseRoute(window.location.hash).step : initial.view.step, category: /#\/(recommend|onboard)\//.test(window.location.hash) ? parseRoute(window.location.hash).category : initial.session.category });
  const { page, category, step } = view;
  // One key per screen: a new key remounts the content so its entrance plays, in the direction the move reads as (navigation.ts).
  const viewKey = ['recommend', 'onboard'].includes(page) ? `${page}/${category}/${step}` : page;
  const motion = useRef<{ key: string; view: View; direction: 'forward' | 'back' }>({ key: viewKey, view, direction: 'forward' });
  if (motion.current.key !== viewKey) motion.current = { key: viewKey, view, direction: navigationDirection(motion.current.view, view) };
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
  const [editingProfile, setEditingProfile] = useState(initial.editingProfile || false);
  const [filter, setFilter] = useState<'all' | Category>('all');
  const [dialog, setDialog] = useState<Dialog>(null);
  // The signed-in account (server mode). Its store follows the account: downloaded on login, uploaded after each change.
  const [account, setAccount] = useState<Account | null>(readAccount);
  const [syncState, setSyncState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const [deletePassword, setDeletePassword] = useState(''), [deleteError, setDeleteError] = useState('');
  const [tasteDecade, setTasteDecade] = useState(0);
  // The hour (and, only on request, the weather) shapes the first quick condition on the home screen.
  const [weather, setWeather] = useState<Weather | null>(readWeather);
  const [weatherBusy, setWeatherBusy] = useState(false);
  const slot = timeSlot();
  // Spoken words join the sentence; the rules and the AI then read it like typed text.
  const voice = useVoiceInput(text => setSession(s => changeText(s, (s.raw.trim() ? `${s.raw.trimEnd()} ` : '') + text)), message => notify(message));
  const [reportItem, setReportItem] = useState<Item | null>(null), [reportedIds, setReportedIds] = useState<string[]>([]);
  const [songChecks, setSongChecks] = useState<Record<string, SongStatus>>({});
  const [syncAttempt, setSyncAttempt] = useState(0), syncFailureTold = useRef(false);
  const syncSkip = useRef(0);  // store versions that came from the server need no upload
  const [feedbackItem, setFeedbackItem] = useState<Item | null>(null);
  const [historyPreview, setHistoryPreview] = useState<HistoryEntry | null>(null);
  const [presetPreview,setPresetPreview]=useState<Preset|null>(null);
  const [savePresetOpen,setSavePresetOpen]=useState(false);
  const [presetName,setPresetName]=useState('');
  const [detail,setDetail]=useState<{item:Item;reasons?:Recommendation}|null>(null);
  const [compareOpen,setCompareOpen]=useState(false);
  const [playlistOpen, setPlaylistOpen] = useState(false);
  const stats = useMemo(() => computeStats(store.history), [store.history]);
  // Finding a record: by words, by day on the calendar, or both. Cleared on every navigation like the category filter.
  const [historyQuery, setHistoryQuery] = useState(''), [historyDay, setHistoryDay] = useState(''), [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => monthOf(seoulDay(new Date())));
  const [manualOpen, setManualOpen] = useState(false);
  // A slip in the sentence, with the word it probably meant; applied only by a tap.
  const typos = useMemo(() => typoSuggestions(session.raw, category), [session.raw, category]);
  const shownHistory = store.history.filter(h => (filter === 'all' || h.category === filter) && matchesHistory(h, historyQuery) && (!historyDay || seoulDay(h.date) === historyDay));
  const [deleteId, setDeleteId] = useState('');
  const [tasteFilter, setTasteFilter] = useState('');
  const [showAllChoices, setShowAllChoices] = useState(false);
  const [showMoods, setShowMoods] = useState(false);
  // How to add to taste is said once, on the first results seen in this browser.
  const [showLikeHint] = useState(() => { try { return !localStorage.getItem('nowrecommend-like-hint-seen'); } catch { return false; } });
  const [settingsTab, setSettingsTab] = useState<'profile' | 'screen' | 'data'>('profile');
  // The lab compares both engines for one category at a time; the choice survives a reload of this tab.
  const [labCategory, setLabCategory] = useState<Category>(() => { try { return sessionStorage.getItem('nowrecommend-lab-category') === 'music' ? 'music' : 'food'; } catch { return 'food'; } });
  const [nameDraft, setNameDraft] = useState(store.name);
  const [busy, setBusy] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [requestError, setRequestError] = useState<false | 'demo' | 'server'>(false);
  const [failNext, setFailNext] = useState(false);
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
      }
      dispatchView(next); setRequestError(false);
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
  useEffect(() => { setTabWarning(!writeTab({ version: 1, view, session, active, draftProfile, editingProfile, query, selectedOnly, completedId })); }, [view, session, active, draftProfile, editingProfile, query, selectedOnly, completedId]);
  const previousPage = useRef(page);
  // Taste browsing (search, genre filter, "선택한 항목만") belongs to one category: a music filter left on the food screen
  // emptied its list with no visible control (review 2026-10-27). Any category change, including the back button, resets it.
  const browsedCategory = useRef(category);
  useEffect(() => { if (browsedCategory.current !== category) { browsedCategory.current = category; setQuery(''); setSelectedOnly(false); setTasteFilter(''); setTasteDecade(0); setShowAllChoices(false); setShowMoods(false); setDraftProfile(stateRef.current.store.profiles[category]); } }, [category]);
  const candidateStatus = candidateInfo(session, store.profiles[session.category]);
  const conflicts = conditionConflicts(session);
  const results = useMemo(() => recommend(session, store.profiles[session.category], items), [session, store.profiles, items]);
  const allPinned=results.length>0 && results.every(r=>session.pinnedIds?.includes(r.item.id));
  const familiarCount = results.filter(r => store.profiles[session.category].selected.includes(r.item.id)).length;
  // Cards shown again although they were seen earlier in this request (pinned ones are kept on purpose), what is still
  // unseen, and cards that match none of the wanted tags (tags rank candidates, they do not filter them).
  const repeatedCount = (session.repeatIds || []).filter(id => results.some(r => r.item.id === id) && !session.pinnedIds?.includes(id)).length;
  const unseenLeft = eligibleCandidates(session, store.profiles[session.category], items).filter(i => !session.seenIds?.includes(i.id)).length;
  // AI picks carry the model's own tags, so a missing tag is not a shortage of registered candidates: no off-topic notice for them.
  const offTopicCount = session.conditions.tags.length && session.quality?.engine !== 'ai' ? results.filter(r => !r.item.tags.some(t => session.conditions.tags.includes(t))).length : 0;

  useEffect(() => { const failed = storageBlocked || !writeStore(store); setStorageWarning(failed); if (failed) setToast(t=>t ? {...t,message:'이번 변경을 브라우저에 저장하지 못했어요. 화면에서만 유지돼요.'} : null); }, [store, storageBlocked]);
  useEffect(() => { if (page === 'complete' && !completed?.selected) setPage('history'); }, [page, completed]);
  // The account as the server has it now: being made an admin shows without logging in again. The server checks on every request anyway.
  useEffect(() => {
    if (!account || !apiEnabled()) return;
    let live = true;
    fetchMe(account.token).then(me => { if (live && !!me.user.isAdmin !== !!account.user.isAdmin) { const next = { ...account, user: me.user }; writeAccount(next); setAccount(next); } }).catch(() => { /* the store sync reports an expired sign-in */ });
    return () => { live = false; };
  }, [account?.token]);  // eslint-disable-line react-hooks/exhaustive-deps
  // Upload the store to the account 1.5s after the last change. A 401 means the token expired: sign out, keep the local data.
  useEffect(() => {
    if (!account || !apiEnabled()) return;
    if (syncSkip.current > 0) { syncSkip.current--; return; }
    const token = account.token, snapshot = store;
    setSyncState('saving');
    const timer = setTimeout(() => {
      pushRemoteStore(token, snapshot).then(() => { syncFailureTold.current = false; setSyncState('saved'); }).catch(error => {
        setSyncState('failed');
        if (error instanceof ApiError && error.status === 401) { setAccount(null); writeAccount(null); notify('로그인이 만료되어 로그아웃했어요. 데이터는 이 브라우저에 남아 있어요.'); }
        else if (!syncFailureTold.current) { syncFailureTold.current = true; notify('계정에 저장하지 못했어요. 이 브라우저에는 남아 있고, 내 계정에서 다시 저장할 수 있어요.'); }
      });
    }, 1500);
    return () => clearTimeout(timer);
  }, [store, account, syncAttempt]);  // eslint-disable-line react-hooks/exhaustive-deps
  async function signIn(session: AuthSession, mode: 'login' | 'signup') {
    const next: Account = { token: session.token, user: session.user };
    const remote = session.hasStore ? (await fetchRemoteStore(session.token).catch(() => ({ store: null }))).store : null;
    const merged = mergeOnLogin(store, remote, next);
    if (merged.action === 'downloaded') { keepLocalCopy(localStorage.getItem('nowrecommend-prototype-v1')); syncSkip.current++; }
    writeAccount(next); setAccount(next); setStore(merged.store); setNameDraft(merged.store.name);
    setActive(false); setSession(newSession(category)); setCompletedId(''); selectionLock.current = ''; setDialog(null);
    navigate('home');
    notify(mode === 'signup' ? `${session.user.name}님, 가입을 환영해요. 이 브라우저의 데이터를 계정에 저장했어요.` : merged.action === 'downloaded' ? `${session.user.name}님, 계정의 취향·기록을 불러왔어요.` : `${session.user.name}님, 로그인했어요. 이 브라우저의 데이터를 계정에 저장해요.`);
  }
  function signOut() { writeAccount(null); setAccount(null); setSyncState('idle'); setDialog(null); notify('로그아웃했어요. 취향·기록은 이 브라우저에 그대로 남아요.'); }
  useEffect(() => { if (!toast || toastPaused || reportItem || dialog || feedbackItem || historyPreview || presetPreview || savePresetOpen || detail || compareOpen) return; const timer = setTimeout(() => setToast(null), 6500); return () => clearTimeout(timer); }, [toast, toastPaused, dialog, feedbackItem, historyPreview, presetPreview, savePresetOpen, detail, compareOpen, reportItem]);
  useEffect(() => { if (previousPage.current !== page) { window.scrollTo({ top: 0, behavior: 'instant' }); previousPage.current = page; } }, [page]);
  // A preview belongs to the screen it started on.
  useEffect(() => { stopPreview(); }, [page, step]);
  useEffect(() => () => { requestCounter.current++; }, []);
  useEffect(() => { if (page === 'recommend' && step === 'results' && showLikeHint) { try { localStorage.setItem('nowrecommend-like-hint-seen', '1'); } catch { /* it just shows again */ } } }, [page, step, showLikeHint]);
  useEffect(()=>{ const frame=requestAnimationFrame(()=>{window.scrollTo({top:0,behavior:'instant'});const title=document.querySelector<HTMLElement>('main h1');title?.setAttribute('tabindex','-1');title?.focus({preventScroll:true});});return ()=>cancelAnimationFrame(frame);},[page,step]);

  const notify = (message: string, undo?: () => void) => {setToastPaused(false);setToast({ message: storageWarning ? '화면에 반영했지만 브라우저에는 저장하지 못했어요.' : message, undo });};
  // The buttons pressed here disappear with the toast, so a keyboard user continues from the page instead of the top of the document.
  const dismissToast = () => { setToast(null); document.getElementById('main-content')?.focus({ preventScroll: true }); };
  function navigate(next: Page) { requestCounter.current++; setBusy(false); setParsing(false); setRequestError(false); setToast(null); setPage(next); setQuery(''); setTasteFilter(''); setTasteDecade(0); setFilter('all'); setHistoryQuery(''); setHistoryDay(''); }
  // A request starts at the composer. Taste is offered there and never stands in the way.
  function start(next: Category, raw = '', forceNew = false) {
    if (!forceNew && !raw && active && session.category === next) { setCategory(next); navigate('recommend'); return; }
    setActive(true); setSelectedOnly(false);
    requestCounter.current++; setBusy(false); setParsing(false); setRequestError(false); setToast(null); setQuery('');
    setCategory(next); setStep('input'); setSession({ ...newSession(next), category: next, raw, conditions: parseConditions(raw, next), editor: createEditor(raw, next), excludedIds: [], revision: 0 });
    setPage('recommend');
  }
  function applyWeather() {
    if (!navigator.geolocation) { notify('이 브라우저에서는 위치를 쓸 수 없어 시간만 반영해요.'); return; }
    setWeatherBusy(true);
    navigator.geolocation.getCurrentPosition(
      position => requestWeather(position.coords.latitude, position.coords.longitude).then(w => { setWeather(w); notify(`${weatherLabel(w)} · 지금 조건에 날씨를 반영했어요.`); }).catch(() => notify('날씨를 가져오지 못해 시간만 반영해요.')).finally(() => setWeatherBusy(false)),
      () => { setWeatherBusy(false); notify('위치를 확인하지 못해 시간만 반영해요.'); }, { timeout: 8000, maximumAge: 600000 });
  }
  // The share sheet where there is one, the clipboard elsewhere; either way the person hears what happened.
  async function share(input: ShareInput) {
    const outcome = await shareResults(input);
    if (outcome === 'copied') notify('추천 내용을 복사했어요. 원하는 곳에 붙여 넣으세요.');
    else if (outcome === 'failed') notify('이 환경에서는 공유하거나 복사할 수 없어요.');
  }
  function endRequest() { setActive(false); setSession(newSession(category)); setStep('input'); navigate('home'); notify('이번 요청을 종료했어요.'); }
  function editTaste(next: Category) { setShowAllChoices(false); setSelectedOnly(false); setTasteFilter(''); setTasteDecade(0); setCategory(next); setDraftProfile(store.profiles[next]); setEditingProfile(true); setQuery(''); navigate('onboard'); }
  function addTaste() { setSelectedOnly(false); setTasteFilter(''); setTasteDecade(0); setDraftProfile(store.profiles[category]); setEditingProfile(false); setShowAllChoices(false); setPage('onboard'); }
  function saveProfile() {
    setStore(s => ({ ...s, profiles: { ...s.profiles, [category]: draftProfile } }));
    if (editingProfile) navigate('taste'); else setPage('recommend');
    notify(editingProfile ? '내 취향을 저장했어요. 다음 추천부터 반영해요.' : '내 취향을 저장했어요. 이제 지금의 상황을 알려주세요.');
  }
  function skipTaste() { setPage('recommend'); }
  // Light feedback on a result: the item joins the taste profile, which the next recommendation really uses.
  function likeItem(item: Item) {
    if (store.profiles[item.category].selected.includes(item.id)) return;
    setStore(s => ({ ...s, profiles: { ...s.profiles, [item.category]: { ...s.profiles[item.category], selected: [...s.profiles[item.category].selected, item.id], disliked: s.profiles[item.category].disliked.filter(id => id !== item.id) } } }));
    notify(`${item.name}을(를) 내 취향에 추가했어요. 다음 추천부터 반영해요.`, () => setStore(s => ({ ...s, profiles: { ...s.profiles, [item.category]: { ...s.profiles[item.category], selected: s.profiles[item.category].selected.filter(id => id !== item.id) } } })));
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
  // Offline (no VITE_API_BASE_URL) or an explicit fallback computes locally and synchronously, exactly as before.
  // With the API server, the request is async: stale answers are dropped via requestCounter and failures offer a retry.
  function withBatch(base: Session, profile: Profile, done: (next: Session) => void, local = false) {
    if (!apiEnabled() || local) { done({ ...nextBatch(base, profile), source: local ? 'local' : undefined, quality: undefined }); return; }
    const token = ++requestCounter.current;
    setBusy(true); setRequestError(false);
    fetchRecommendations(base, profile)
      .then(remote => { if (token === requestCounter.current) { rememberItems(remote.results.map(r => r.item), items); done({ ...applyBatch(base, remote.results), source: 'server', quality: qualityOf(remote.meta) }); } })
      .catch(() => { if (token === requestCounter.current) setRequestError('server'); })
      .finally(() => { if (token === requestCounter.current) setBusy(false); });
  }
  // "치킨" → its detail menus: a new request within that dish, keeping the conditions, so 뿌링클 and 허니콤보 come back by name.
  function refineMenu(item: Item) {
    const base = { ...newSession(item.category), raw: `${item.name} 중에서 골라줘`, conditions: cleanConditions(session.conditions) };
    withBatch(base, store.profiles[item.category], current => {
      setSession(current); record(current); setStep('results');
      window.scrollTo({ top: 0, behavior: 'instant' });
      requestAnimationFrame(() => document.querySelector<HTMLElement>('main h1')?.focus());
    });
  }
  function restoreTemporary(id: string) {
    withBatch({...session,excludedIds:session.excludedIds.filter(v=>v !== id)},store.profiles[session.category],current=>{
      setSession(current);record(current,[{itemId:id,scope:'session',action:'restore',date:new Date().toISOString()}]);
    });
  }
  // One submit: server mode asks /api/parse once per new sentence (re-submitting the same sentence keeps the user's removals),
  // then recommends with the merged conditions. A conflict the AI introduced stops on the compose screen instead.
  function submit() {
    if (conflicts.length) return;
    const raw = session.raw, parsed = changeText(session, raw);
    setSession(parsed);
    const known = parsed.editor?.ai?.raw === raw && parsed.editor.ai.source !== 'local';
    if (!apiEnabled() || !raw.trim() || known) { run(false, false, false, parsed); return; }
    const token = ++requestCounter.current;
    setParsing(true); setRequestError(false);
    const go = (next: Session) => { if (token !== requestCounter.current) return; setParsing(false); setSession(next); if (!conditionConflicts(next).length) run(false, false, false, next); };
    fetchParse(parsed.category, raw)
      .then(r => go(applyParsed(parsed, raw, r.conditions, { raw, source: r.source })))
      .catch(() => go(applyParsed(parsed, raw, null, { raw, source: 'local' })));
  }
  function run(again = false, skipFailure = false, local = false, base: Session = session) {
    if (conditionConflicts(base).length) return;
    setRequestError(false);
    if (failNext && !skipFailure) { setFailNext(false); setRequestError('demo'); return; }
    withBatch({ ...base, revision: again ? base.revision + 1 : base.revision }, store.profiles[base.category], current => {
      setSession(current); record(current); setStep('results');
      window.scrollTo({ top: 0, behavior: 'instant' });
    }, local);
  }
  function applyFeedback(scope: 'session' | 'long') {
    if (!feedbackItem) return;
    const id = feedbackItem.id;
    const previousSession = session;
    const next = updateFeedback(store.profiles[category], session, id, scope);
    setStore(s => ({ ...s, profiles: { ...s.profiles, [category]: next.profile } }));
    // The excluded card disappears at once (the snapshot is filtered); the refill may take a server round trip.
    setSession(next.session); setFeedbackItem(null);
    withBatch(next.session, next.profile, displayed => {
      setSession(displayed); record(displayed,[{itemId:id,scope,action:'exclude',date:new Date().toISOString()}]);
      notify(scope === 'session' ? '이번 추천에서 제외했어요. 새 요청에서는 다시 추천될 수 있어요.' : '장기 비선호에 추가했어요. 다음 추천에도 반영할게요.', () => {
        if (scope === 'long') setStore(s => ({ ...s, profiles: { ...s.profiles, [category]: { ...s.profiles[category], disliked: s.profiles[category].disliked.filter(v => v !== id) } } }));
        const restored = {...previousSession,roundId:crypto.randomUUID(),seenIds:[...new Set([...(displayed.seenIds || []),...(previousSession.seenIds || [])])]};
        setSession(restored);record(restored,[{itemId:id,scope,action:'restore',date:new Date().toISOString()}]);
      });
    });
  }
  // Re-recommending reuses the sentence and the stored tags/exclusions only; a past budget is never applied again.
  function reuse(entry: HistoryEntry) { const raw = entry.raw === '직접 선택한 조건' || entry.raw === MANUAL_RAW ? '' : entry.raw; setHistoryPreview(null); start(entry.category, raw, true); setSession({ ...newSession(entry.category), category: entry.category, raw, conditions: cleanConditions(entry.conditions), excludedIds: [], revision: 0, ...(entry.years ? { years: entry.years } : {}) }); }
  function applyQuickCondition(preset: Preset) {
    const before = active && session.category === preset.category ? session : newSession(preset.category);
    start(preset.category, '', true);
    setSession({ ...applyPreset(before, preset.conditions), preset: { name: preset.name, key: presetKey(preset.conditions) } });
    setStep('input'); setPresetPreview(null);
    notify('선택한 조건을 적용했어요.', () => setSession(before));
  }
  function chooseQuickCondition(preset: Preset) {
    const writing = active && session.category === preset.category && (session.raw.trim() || session.conditions.tags.length || session.conditions.excluded.length);
    if (writing) setPresetPreview(preset); else applyQuickCondition(preset);
  }
  function recommendSaved(c:Category,ids:string[]) { start(c,'',true);setSession({...newSession(c),editor:createEditor('',c),candidateScope:'favorites',candidateIds:[...ids]}); }
  function replaceOne(id:string) {
    const done=(next:Session|null)=>{if(!next){notify('교체할 새로운 후보가 없어요. 조건을 바꾸거나 새 요청을 시작해주세요.');return;}setSession(next);record(next);notify('다른 후보로 한 장만 교체했어요.');};
    const profile=store.profiles[session.category];
    if(!apiEnabled()){done(replaceCandidate(session,profile,id));return;}
    if(!canReplace(session,results,id))return;
    const base=session,current=results,token=++requestCounter.current;
    setBusy(true);setRequestError(false);
    fetchRecommendations(replacementRequest(base,current),profile,{count:1})
      .then(remote=>{if(token===requestCounter.current){rememberItems(remote.results.map(r=>r.item),items);const next=applyReplacement(base,current,id,remote.results);done(next && {...next,source:'server',quality:qualityOf(remote.meta)});}})
      .catch(()=>{if(token===requestCounter.current)setRequestError('server');})
      .finally(()=>{if(token===requestCounter.current)setBusy(false);});
  }
  function importStore(next:typeof store):string|null {
    if(!replaceStore(next))return '브라우저에 저장하지 못했어요. 기존 데이터는 유지돼요.';
    setStore(next);setStorageBlocked(false);setStorageWarning(false);setSession(newSession());setActive(false);setCompletedId('');setDraftProfile(next.profiles.food);setEditingProfile(false);selectionLock.current='';setDialog(null);navigate('home');notify('백업 데이터를 가져왔어요.');return null;
  }
  const presetList=(c:Category)=><Presets category={c} presets={store.presets || []} now={momentPreset(c, slot, weather)} onPreview={chooseQuickCondition} onRename={(id,name)=>{setStore(s=>({...s,presets:(s.presets || []).map(p=>p.id===id ? {...p,name} : p)}));notify('프리셋 이름을 변경했어요.');}} onDelete={id=>{const deleted=store.presets?.find(p=>p.id===id);setStore(s=>({...s,presets:(s.presets || []).filter(p=>p.id!==id)}));notify('프리셋을 삭제했어요.',()=>{if(deleted)setStore(s=>({...s,presets:[...(s.presets || []),deleted]}));});}}/>;

  const pageTitle: Record<Page, string> = { home: '홈', recommend: `${categoryLabel[category]} 추천`, onboard: editingProfile ? '취향 편집' : '첫 취향 등록', favorites: '즐겨찾기', history: '추천 기록', taste: '내 취향', login: '체험 시작', complete: '선택 완료', type: '취향 유형 테스트', admin: '오류 신고 관리', lab: 'AI 실험실' };
  const navItems = [{ page: 'home' as Page, label: '홈', icon: House }, { page: 'recommend' as Page, category: 'food' as Category, label: '음식 추천', icon: Utensils }, { page: 'recommend' as Page, category: 'music' as Category, label: '음악 추천', icon: Headphones }];
  const myItems = [{ page: 'favorites' as Page, label: '즐겨찾기', icon: Heart }, { page: 'history' as Page, label: '추천 기록', icon: Clock3 }, { page: 'taste' as Page, label: '내 취향', icon: SlidersHorizontal }];
  const chips = (values: string[], selected: string[], onClick: (v: string) => void, kind = '') => <div className="chips">{values.map(v => <button key={v} className={`chip ${kind} ${selected.includes(v) ? 'selected' : ''}`} aria-pressed={selected.includes(v)} onClick={() => onClick(v)}>{selected.includes(v) && <Check size={13} />}{v}</button>)}</div>;
  const tabFilter = <div className="filter-tabs" role="group" aria-label="분야 필터">{(['all', 'food', 'music'] as const).map(f => <button key={f} aria-pressed={filter === f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>{f === 'all' ? '전체' : categoryLabel[f]}</button>)}</div>;
  const reportSongCheck = (id: string, status: SongStatus) => setSongChecks(all => all[id] === status ? all : { ...all, [id]: status });
  const itemCard = (item: Item, reasons?: Recommendation) => <RecommendationCard key={item.id} onReport={apiEnabled() && !!reasons ? () => setReportItem(item) : undefined} reported={reportedIds.includes(item.id)} onRefine={apiEnabled() && item.category === 'food' && reasons && (reasons.broad || !reasons.aiPick) ? () => refineMenu(item) : undefined} onSongStatus={reportSongCheck} item={item} saved={store.favorites.includes(item.id)} persisted={!storageWarning} reasons={reasons} confidence={reasons?.confidence} aiPick={reasons?.aiPick || (!!reasons && isAiPick(item.id))} checks={reasons ? conditionChecks(item, session.conditions) : undefined} familiar={!!reasons && store.profiles[item.category].selected.includes(item.id)} onLike={reasons && !store.profiles[item.category].selected.includes(item.id) ? () => likeItem(item) : undefined} onSave={() => favorite(item.id)} onDetails={()=>setDetail({item,reasons})} onExclude={() => setFeedbackItem(item)} onSelect={reasons ? () => choose(reasons) : undefined} pinned={session.pinnedIds?.includes(item.id)} compared={session.compareIds?.includes(item.id)} compareDisabled={(session.compareIds?.length || 0)>=3 && !session.compareIds?.includes(item.id)} onPin={reasons?()=>setSession(s=>({...s,pinnedIds:toggle(s.pinnedIds || [],item.id)})):undefined} onReplace={reasons?()=>replaceOne(item.id):undefined} onCompare={reasons?()=>setSession(s=>({...s,compareIds:toggle(s.compareIds || [],item.id)})):undefined}/>;

  // Navigation: top bar on wide screens, bottom tab bar on phones (DESIGN.md §2). Same accessible names in both.
  const allNav: { page: Page; label: string; icon: typeof House; category?: Category }[] = [...navItems, ...myItems];
  const shortLabel: Record<string, string> = { '홈': '홈', '음식 추천': '음식', '음악 추천': '음악', '즐겨찾기': '즐겨찾기', '추천 기록': '기록', '내 취향': '취향' };
  const navLink = (n: typeof allNav[number]) => <button key={n.label} aria-label={n.label} aria-current={navActive(n) ? 'page' : undefined} className={`topnav-link ${n.category ? `cat-${n.category}` : ''} ${navActive(n) ? 'active' : ''}`} onClick={() => goNav(n)}>{shortLabel[n.label]}{n.page === 'favorites' && store.favorites.length > 0 && <span className="nav-count" aria-hidden="true">{store.favorites.length}</span>}</button>;
  // Onboarding belongs to the taste page when editing, otherwise to that category's recommendation.
  const navPage: Page = page === 'onboard' ? (editingProfile ? 'taste' : 'recommend') : page;
  const navActive = (n: typeof allNav[number]) => navPage === n.page && (!n.category || category === n.category);
  const goNav = (n: typeof allNav[number]) => n.category ? start(n.category) : navigate(n.page);
  const inFlow = page === 'onboard' || (page === 'recommend' && step === 'input');
  const ctaLabel = parsing ? '조건을 해석하는 중' : busy ? '추천을 고르는 중' : requestError ? '다시 시도하기' : `${categoryLabel[category]} 추천받기`;
  const ctaReady = !busy && !parsing && conflicts.length === 0;
  const conditionCount = session.conditions.tags.length + session.conditions.excluded.length;
  const unsupportedCount = unsupportedConditions(session.raw, session.category).length;
  const hasUntagged = results.some(r => conditionChecks(r.item, session.conditions).some(c => c.state === 'untagged'));
  const kind = category === 'food' ? '메뉴' : '음악';
  // Personalised only if a taste is registered; conditions alone are not "내 취향".
  const unconfirmedSongs = results.filter(r => ['missing', 'failed'].includes(songChecks[r.item.id])).length;
  const yearsInvalid = category === 'music' && !!session.years && session.years.from !== undefined && session.years.to !== undefined && session.years.from > session.years.to;
  const setYears = (years?: YearRange) => setSession(s => ({ ...s, years, yearsFromText: false, currentIds: undefined, snapshot: undefined }));
  const requestName = session.raw || presetLabel(session) || (category === 'music' && session.years && !conditionCount ? `${yearLabel(session.years)} 음악` : '') || (conditionCount ? `고른 조건에 맞춘 ${kind}` : hasTaste(store.profiles[category]) ? `내 취향으로 고른 ${kind}` : `지금 만나볼 ${kind}`);
  const resumeName = session.raw || presetLabel(session) || '직접 고른 조건';
  const requestHasContent = !!session.raw.trim() || conditionCount > 0 || !!session.roundId;
  const categoryItems = items.filter(i => i.category === category);
  // The home doors and the login wall show real photos and covers; typeset covers only fill what is missing.
  const showcase = (c: Category, count = 6) => { const prefer = c === 'food' ? ['f07', 'f05', 'f13', 'f06', 'f09', 'f10'] : ['m05', 'm03', 'm06', 'm01', 'm09', 'm12'];
    const own = items.filter(i => i.category === c), withArt = own.filter(i => mediaFor(i.id));
    return [...prefer.map(id => withArt.find(i => i.id === id)).filter((i): i is Item => !!i), ...withArt, ...own].filter((i, n, all) => all.indexOf(i) === n).slice(0, count); };
  const browseTags = category === 'music' ? ['발라드', '팝', '록', '재즈', '피아노', '어쿠스틱', '연주곡', '차분함', '활기참'] : ['한식', '중식', '일식', '양식', '아시안', '분식', '간식', '국물', '매콤함', '담백함'];
  // Search and filters only apply while their controls are on screen (long lists), so nothing hidden can empty the list.
  const browsing = categoryItems.length > 24, activeFilter = browsing && browseTags.includes(tasteFilter) ? tasteFilter : '';
  const visibleChoices = categoryItems.filter(i => (!selectedOnly || draftProfile.selected.includes(i.id)) && (!activeFilter || i.tags.includes(activeFilter)) && (!tasteDecade || (i.releaseYear !== undefined && i.releaseYear >= tasteDecade && i.releaseYear <= tasteDecade + 9)) && `${i.name} ${i.subtitle}`.toLowerCase().includes(query.toLowerCase()));

  // Likes already chosen stay in view, so they can always be seen and changed.
  const moodsOpen = showMoods || draftProfile.tags.length > 0;
  const tasteKey = (p: Profile) => JSON.stringify([[...p.selected].sort(), [...p.tags].sort(), p.selected.map(id => p.reasons?.[id] || ''), p.custom || []]);
  const tasteUnchanged = tasteKey(draftProfile) === tasteKey(store.profiles[category]);
  // Twelve to start with, plus anything already picked; searching or filtering shows every match.
  const shownChoices = showAllChoices || query || activeFilter || tasteDecade || selectedOnly ? visibleChoices : visibleChoices.filter((i, n) => n < 24 || draftProfile.selected.includes(i.id));

  return <div className={`app-shell page-${page}${inFlow ? ' in-flow' : ''} ${page === 'lab' ? ` cat-${labCategory}` : page === 'complete' ? ` cat-${completed?.category || category}` : ['recommend', 'onboard'].includes(page) ? ` cat-${category}` : ''}`}>
    <a className="skip-link" href="#main-content" onClick={e=>{e.preventDefault();document.getElementById('main-content')?.focus();}}>본문 바로가기</a>
    <header className="appbar">
      <div className="appbar-inner">
        <button className="brand" onClick={() => navigate('home')} aria-label="지금 추천 홈">지금 추천<span className="brand-dot" aria-hidden="true" /></button>
        <nav className="topnav" aria-label="주요 메뉴">
          <div className="topnav-group">{navItems.slice(1).map(navLink)}</div>
          <div className="topnav-group end">{myItems.map(navLink)}</div>
        </nav>
        <div className="appbar-actions">
          <button className="icon-button help-link" aria-label="체험 안내" onClick={() => setDialog('about')}><Info size={20} /></button>
          {apiEnabled() && !account && <button className="login-button" onClick={() => navigate('login')}>로그인</button>}
          <button className={`top-avatar${account ? ' signed-in' : ''}${account && syncState === 'failed' ? ' sync-failed' : ''}`} aria-label={account ? syncState === 'failed' ? '내 계정, 저장 실패' : '내 계정' : '브라우저 프로필'} title={account ? account.user.email : undefined} onClick={() => { setNameDraft(store.name); setSettingsTab('profile'); setDialog('account'); }}>{account ? <b>{account.user.name.slice(0, 1)}</b> : <Settings2 size={20} />}</button>
        </div>
      </div>
    </header>
    <main tabIndex={-1} id="main-content" className={`main-content ${page}${page === 'recommend' ? ` step-${step}` : ''}`}>
      {tabWarning && <div className="notice warning" role="status">현재 요청을 탭에 저장하지 못했어요. 새로고침하면 입력과 일시 제외가 사라질 수 있어요.</div>}
      {storageBlocked && <div className="notice warning"><div><strong>저장된 데이터가 손상되어 원본을 보호하고 있어요.</strong><p>현재 변경은 영구 저장하지 않아요. 원본을 내려받아 보관한 뒤 설정에서 초기화할 수 있어요.</p><button className="button secondary" onClick={() => downloadRecovery(loaded.raw || '')}>손상 원본 내려받기</button><button className="text-button" onClick={()=>setDialog('reset')}>초기화 확인</button></div></div>}
      {storageWarning && !storageBlocked && <div className="notice warning">이번 변경을 브라우저에 저장하지 못했어요. 화면에는 반영되지만 새로고침하면 변경 내용이 사라질 수 있어요. <button className="button secondary" onClick={()=>setStorageWarning(!writeStore(store))}>저장 재시도</button></div>}

      <div className="page-view" key={viewKey} data-direction={motion.current.direction}>
      {page === 'home' && <>
        <section className="home-hero"><h1><span>오늘 뭐 먹고,</span> <span>뭐 들을까요?</span></h1>
          <p className="moment-note"><CloudSun size={15} /><span>지금은 {slotLabel[slot]}{weather ? ` · ${weatherLabel(weather)}` : ''}</span>{weather ? <button className="text-button" onClick={() => { clearWeather(); setWeather(null); }}>날씨 반영 끄기</button> : <button className="text-button" disabled={weatherBusy} onClick={applyWeather}>{weatherBusy ? '날씨 확인 중' : '지금 날씨 반영'}</button>}</p>
        </section>
        {active && requestHasContent && <section className={`resume-banner cat-${session.category}`}>
          <p className="resume-copy"><span>진행 중</span> <strong>{resumeName}</strong></p>
          <button className="text-button resume-end" onClick={endRequest}>요청 종료</button>
          <button className="button primary compact" onClick={() => start(session.category)}>이어서 보기</button>
        </section>}
        <section className="doors" aria-label="추천 시작">{(['food', 'music'] as Category[]).map(c => <div className={`door-group cat-${c}`} key={c}>
          <button className={`door ${c}`} onClick={() => start(c)}>
            <span className="door-copy">
              <strong>{c === 'food' ? '오늘 뭐 먹지' : '지금 뭐 듣지'}</strong>
              <small>{hasTaste(store.profiles[c]) ? `내 취향 ${store.profiles[c].selected.length + store.profiles[c].tags.length}개 반영` : '취향 없이도 바로'}</small>
              <span className="door-go">{categoryLabel[c]} 추천받기 <ArrowRight size={17} /></span>
            </span>
            <span className="door-art" aria-hidden="true">{showcase(c, 3).map(i => <ItemArt key={i.id} item={i} size="tile" eager />)}</span>
          </button>
          {presetList(c)}
        </div>)}</section>
        {store.history.some(h => h.selected) && <section className="home-section">
          <div className="section-heading"><h2>최근 선택</h2><button className="text-button" onClick={() => navigate('history')}>전체 기록</button></div>
          <div className="recent-list">{store.history.filter(h=>h.selected).slice(0,6).map(h => <button className="recent-choice" key={h.id} onClick={()=>setHistoryPreview(h)}>
            <ItemArt item={h.selected!.result.item} size="tile" />
            <b>{h.selected!.result.item.name}</b>
          </button>)}</div>
        </section>}
        <p className="lab-link"><button className="text-button" onClick={() => navigate('type')}>내 취향 유형 알아보기 <ArrowRight size={14} /></button>{apiEnabled() && <button className="text-button" onClick={() => navigate('lab')}>AI 실험실 <ArrowRight size={14} /></button>}</p>
      </>}

      {page === 'onboard' && <>
        <div className="flow-head">
          <button className="back-link" onClick={() => navigate(editingProfile ? 'taste' : 'recommend')}><ArrowLeft size={16} /> 돌아가기</button>
          <h1>평소 좋아하는 {category === 'food' ? '음식을' : '음악을'} 골라주세요.</h1>
          <p>{category === 'food' ? '좋아하는 메뉴' : '좋아하는 곡'} 3개 정도 골라보세요.{editingProfile ? '' : ' 건너뛰어도 돼요.'}</p>
          <button className="text-button to-moods" aria-expanded={moodsOpen} aria-controls="taste-moods" onClick={() => setShowMoods(open => { if (!open) requestAnimationFrame(() => document.querySelector<HTMLElement>('#taste-moods button')?.focus()); return !open; })}>{category === 'food' ? '메뉴 대신 맛으로 고르기' : '곡 대신 분위기로 고르기'}{draftProfile.tags.length > 0 && ` · ${draftProfile.tags.length}개`}<ChevronDown size={15} className="chevron" /></button>
          {moodsOpen && <div className="taste-tags" id="taste-moods">{chips(options[category].filter(t => !['혼자', '함께', '점심', '저녁', '과제', '운동', '산책', '휴식'].includes(t) && !t.includes('에너지')), draftProfile.tags, v => setDraftProfile(p => ({ ...p, tags: toggle(p.tags, v) })))}</div>}
          {!editingProfile && <button className="button secondary skip-taste" onClick={skipTaste}>취향 없이 바로 추천받기 <ArrowRight size={16} /></button>}
        </div>
        <div className="flow-body">
          <section className="selection-panel">
            {/* Search always, since it is also how a dish or song the list lacks gets added; genre browsing only once the list is long. */}
            <div className="selection-search">
              <label className="search-field"><Search size={18} /><input aria-label="취향 항목 검색" placeholder={category === 'food' ? '메뉴 이름 검색' : '곡명 또는 아티스트 검색'} value={query} onChange={e => setQuery(e.target.value)} /></label>
            </div>
            {query.trim().length >= 2 && !categoryItems.some(i => i.name.toLowerCase() === query.trim().toLowerCase()) && !(draftProfile.custom || []).some(c => c.name === query.trim()) && (draftProfile.custom || []).length < 30 && <button className="button secondary add-custom" onClick={() => { const name = query.trim().slice(0, 60); setDraftProfile(p => ({ ...p, custom: [...(p.custom || []), { id: crypto.randomUUID(), name }] })); setQuery(''); }}><Plus size={16} />‘{query.trim().slice(0, 60)}’ 직접 추가</button>}
            {categoryItems.length > 24 && <details className="taste-browse" open>
              <summary>{category === 'food' ? '종류별로 찾기' : '장르·연대로 찾기'}{tasteFilter && ` · ${tasteFilter}`}<ChevronDown size={16} className="chevron" /></summary>
              {category === 'music' && <div className="chips taste-filter" role="group" aria-label="발매 연대로 좁히기">{[0, 1980, 1990, 2000, 2010, 2020].map(d => <button key={d} className={`chip ${tasteDecade === d ? 'selected' : ''}`} aria-pressed={tasteDecade === d} onClick={() => setTasteDecade(d)}>{d ? `${d}년대` : '전체 연대'}</button>)}</div>}
              <div className="chips taste-filter" role="group" aria-label="장르·분위기로 좁히기">{['', ...browseTags].map(t => <button key={t || 'all'} className={`chip ${tasteFilter === t ? 'selected' : ''}`} aria-pressed={tasteFilter === t} onClick={() => setTasteFilter(t)}>{t || '전체'}</button>)}</div>
              <label className="selected-filter"><input type="checkbox" checked={selectedOnly} onChange={e => setSelectedOnly(e.target.checked)} />선택한 항목만 보기</label>
            </details>}
            <div className={`selection-grid ${category}`}>{shownChoices.map(i => { const on = draftProfile.selected.includes(i.id); return <button key={i.id} className={`selection-card ${on ? 'selected' : ''}`} aria-pressed={on} onClick={() => setDraftProfile(p => ({ ...p, selected: toggle(p.selected, i.id), disliked: p.disliked.filter(id => id !== i.id) }))}><ItemArt item={i} size="tile" /><span className="selection-check" aria-hidden="true">{on && <Check size={15} strokeWidth={3} />}</span><span className="selection-name"><b>{i.name}</b>{category === 'music' && <small>{i.subtitle}</small>}{mediaFor(i.id)?.approx && <small>이미지는 참고용이에요</small>}</span></button>; })}</div>
            {shownChoices.length < visibleChoices.length && <button className="button secondary more-choices" onClick={() => setShowAllChoices(true)}>다른 {category === 'food' ? '메뉴' : '곡'} 더 보기</button>}
            {!visibleChoices.length && <p className="empty-small">{query ? `‘${query}’와 일치하는 항목이 목록에 없어요.` : '일치하는 항목이 없어요.'} <button className="text-button" onClick={() => { setQuery(''); setSelectedOnly(false); setTasteFilter(''); setTasteDecade(0); }}>검색·필터 초기화</button></p>}
          </section>
          <TasteReasons category={category} items={draftProfile.selected.flatMap(id => { const i = resolveItem(items, id); return i ? [i] : []; })} custom={draftProfile.custom || []} reasons={draftProfile.reasons || {}}
            onReason={(id, text) => setDraftProfile(p => ({ ...p, reasons: { ...p.reasons, [id]: text } }))} onCustom={custom => setDraftProfile(p => ({ ...p, custom }))} />
        </div>
        <div className="action-bar"><div className="action-bar-inner">
          {draftProfile.selected.length > 0 && <span className="taste-thumbs" aria-hidden="true">{draftProfile.selected.slice(-5).map(id => { const i = resolveItem(items, id); return i ? <ItemArt key={id} item={i} size="thumb" /> : null; })}</span>}
          <div className="action-status">
            <strong>{draftProfile.selected.length + (draftProfile.custom?.length || 0)}개 선택{draftProfile.tags.length ? ` · 특징 ${draftProfile.tags.length}개` : ''}</strong>
            <p className="selection-help" role="status">{tasteUnchanged ? '바꾼 내용이 없어요' : hasTaste(draftProfile) ? '이대로 저장할 수 있어요' : '비우고 저장하면 취향 없이 추천해요'}</p>
          </div>
          <button className="button primary" disabled={tasteUnchanged} onClick={saveProfile}>{editingProfile ? '저장하기' : '저장하고 시작'}<ArrowRight size={16} /></button>
        </div></div>
      </>}

      {page === 'recommend' && <>
        {session.candidateScope==='favorites' && <div className="notice"><div><strong>저장한 후보 {session.candidateIds?.length || 0}개 안에서 추천</strong><p>요청 시작 시 검색·태그로 고른 즐겨찾기 범위예요. 필수 제외·비선호는 그대로 적용해요.</p><button className="button secondary" onClick={()=>{setSession(s=>({...s,candidateScope:undefined,candidateIds:undefined,currentIds:undefined,snapshot:undefined}));setStep('input');}}>전체 후보로 전환</button></div></div>}
        {step === 'input' && <div className="flow-head">
          <button className="back-link" onClick={() => navigate('home')}><ArrowLeft size={16} /> 홈으로</button>
          <h1>{category === 'food' ? '어떤 한 끼가 필요하세요?' : '어떤 음악이 필요하세요?'}</h1>
          <div className="taste-strip">
            {store.profiles[category].selected.length > 0 && <span className="taste-thumbs" aria-hidden="true">{store.profiles[category].selected.slice(0, 5).map(id => { const i = resolveItem(items, id); return i ? <ItemArt key={id} item={i} size="thumb" /> : null; })}</span>}
            <span className="taste-strip-items">{hasTaste(store.profiles[category]) ? `내 취향 ${store.profiles[category].selected.length + store.profiles[category].tags.length}개 반영` : '지금 상황만으로 추천할게요'}</span>
            <button className="text-button" onClick={addTaste}>{hasTaste(store.profiles[category]) ? '취향 수정' : '취향 추가'}</button>
          </div>
        </div>}
        {step !== 'results' ? <>
          <div className="flow-body composer">
            <section className="panel compose-panel">
              <div className="field-head"><label className="field-title" htmlFor="situation">지금의 상황</label>{voice.supported && <button type="button" className={`voice-button${voice.listening ? ' listening' : ''}`} aria-pressed={voice.listening} aria-label={voice.listening ? '음성 입력 중지' : '말로 입력'} onClick={() => voice.listening ? voice.stop() : voice.start()}>{voice.listening ? <Square size={13} fill="currentColor" /> : <Mic size={15} />}{voice.listening ? '듣는 중' : '말로 입력'}</button>}</div>
              {voice.interim && <p className="voice-interim" aria-live="polite">{voice.interim}</p>}
              <textarea id="situation" rows={3} maxLength={300} value={session.raw} onChange={e => setSession(s => changeText(s, e.target.value))} onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && ctaReady) { e.preventDefault(); submit(); } }} placeholder={category === 'food' ? '예: 혼자 먹을 담백하고 따뜻한 저녁이 먹고 싶어' : '예: 과제하면서 들을 차분한 연주곡을 추천해줘'} />
              <div className="textarea-caption">
                <div className={`example-row${session.raw ? ' quiet' : ''}`}>{(category === 'food' ? ['혼자 먹을 담백한 저녁', '친구랑 먹을 매콤한 국물', '맵지 않고 따뜻한 점심'] : ['과제할 때 듣는 연주곡', '산책할 때 활기찬 음악']).map(text => <button key={text} onClick={() => setSession(s => changeText(s, text))}>{text}</button>)}</div>
                <span>{session.raw.length}/300</span>
              </div>
              {typos.length > 0 && <p className="typo-hint" role="status">혹시 {typos.map((s, n) => <span key={s.from}>{n > 0 && ', '}<button type="button" className="chip small" onClick={() => setSession(current => changeText(current, applySuggestion(current.raw, s)))} aria-label={`${s.from}을 ${s.to}으로 고치기`}>{s.to}</button></span>)} 말씀이신가요?</p>}
              <div className="condition-summary">
                {conditionCount > 0 && <h3>{session.raw.trim() ? '이렇게 이해했어요. 다른 조건은 수정해 주세요.' : '고른 조건'}</h3>}
                {conditionCount ? <div className="chips">
                  {session.conditions.tags.map(t => <button className="chip selected" key={t} onClick={() => conditionTag(t)} aria-label={`${t} 조건 삭제`}>{t}<X size={13} /></button>)}
                  {session.conditions.excluded.map(t => <button className="chip exclude selected" key={t} onClick={() => conditionTag(t, true)} aria-label={`${t} 제외 조건 삭제`}>{t} 제외<X size={13} /></button>)}
                </div> : session.raw.trim() ? <p className="muted small">{apiEnabled() && !(session.editor?.ai?.raw === session.raw && session.editor.ai.source === 'local') ? '따로 표시할 조건은 없지만, 문장 내용을 읽고 추천해요. 아래에서 조건을 직접 고를 수도 있어요.' : '문장에서 반영할 조건을 찾지 못했어요. 아래에서 직접 고를 수 있어요.'}</p> : null}
                <ConditionNotes raw={session.raw} category={category} conditions={session.conditions} />
                <ParseNotice ai={session.editor?.ai} raw={session.raw} hasConditions={conditionCount > 0} />
              </div>
            </section>
            {category === 'music' && <section className="panel year-panel" aria-labelledby="year-title">
              <h3 id="year-title">발매 시기</h3>
              <div className="chips" role="group" aria-labelledby="year-title">
                <button className={`chip ${!session.years ? 'selected' : ''}`} aria-pressed={!session.years} onClick={() => setYears(undefined)}>전체</button>
                {[1980, 1990, 2000, 2010, 2020].map(d => { const on = session.years?.from === d && session.years?.to === d + 9; return <button key={d} className={`chip ${on ? 'selected' : ''}`} aria-pressed={on} onClick={() => setYears(on ? undefined : { from: d, to: d + 9 })}>{d}년대</button>; })}
              </div>
              <div className="year-range">
                <label>시작<input type="number" inputMode="numeric" min={1900} max={2100} placeholder="예: 2015" value={session.years?.from ?? ''} onChange={e => { const v = e.target.value ? +e.target.value : undefined; const next = { ...session.years, from: v }; setYears(next.from === undefined && next.to === undefined ? undefined : next); }} /></label>
                <span aria-hidden="true">~</span>
                <label>끝<input type="number" inputMode="numeric" min={1900} max={2100} placeholder="예: 2019" value={session.years?.to ?? ''} onChange={e => { const v = e.target.value ? +e.target.value : undefined; const next = { ...session.years, to: v }; setYears(next.from === undefined && next.to === undefined ? undefined : next); }} /></label>
              </div>
              {yearsInvalid && <p className="error-box" role="alert">시작 연도가 끝 연도보다 늦어요.</p>}
            </section>}
            <details className="panel more-conditions">
              <summary><SlidersHorizontal size={16} /> 조건 직접 고르기<ChevronDown size={16} className="chevron" /></summary>
              {(category === 'food' ? [{label:'상황', values:['혼자','함께','점심','저녁']}, {label:'원하는 맛·특징', values:options.food.filter(t => !['혼자','함께','점심','저녁'].includes(t))}] : [{label:'활동',values:['과제','휴식','산책','운동']},{label:'분위기',values:options.music.filter(t => !['과제','휴식','산책','운동','보컬','연주곡'].includes(t))},{label:'보컬',values:['보컬','연주곡']}]).map(group => <div className="chip-group" key={group.label}><h3>{group.label}</h3>{chips(group.values,session.conditions.tags,v=>conditionTag(v))}</div>)}
              <div className="chip-group"><h3>반드시 제외 <small>선호 조건보다 먼저 적용해요</small></h3>{chips(exclusions[category], session.conditions.excluded, v => conditionTag(v, true), 'exclude')}</div>
              <div className="preset-panel">
                {presetList(category)}
                <button className="text-button" disabled={conflicts.length>0 || (store.presets || []).filter(p=>p.category===category).length>=20} onClick={()=>{setPresetName('');setSavePresetOpen(true);}}>현재 조건을 프리셋으로 저장</button>
              </div>
            </details>
            {conflicts.length > 0 && <div className="error-box" role="alert">함께 적용할 수 없는 조건이 있어요: {conflicts.join(', ')}. 조건을 해제한 뒤 진행해주세요.</div>}
            {requestError === 'server' && <div className="error-box" role="alert"><strong>추천 서버에 연결하지 못했어요.</strong><p>잠시 후 다시 시도하거나, 이 브라우저의 기본 방식으로 추천받을 수 있어요.</p><button className="text-button" disabled={busy || conflicts.length > 0} onClick={() => run(false, true, true)}>기본 추천으로 보기 <ArrowRight size={14} /></button></div>}
            {requestError === 'demo' && <div className="error-box" role="alert"><strong>조건 확인을 잠시 완료하지 못했어요.</strong><p>다시 시도하거나, 지금 직접 고른 조건으로 추천받을 수 있어요.</p><button className="text-button" disabled={conflicts.length > 0} onClick={() => run(false, true)}>직접 선택한 조건으로 계속 <ArrowRight size={14} /></button></div>}
          </div>
          {(busy || parsing) && <LoadingResults category={category} stage={parsing ? 'parsing' : 'busy'} />}
          <div className="action-bar"><div className="action-bar-inner">
            {/* Kept visible on phones too: what is ignored must be clear before recommending, not only after. */}
            {unsupportedCount > 0 && <span className="action-warning" role="status">지원하지 않는 조건 {unsupportedCount}개는 반영하지 않아요</span>}
            {conditionCount > 0 && <span className="action-note">조건 {conditionCount}개를 반영해요</span>}
            <button className="button primary" disabled={!ctaReady || yearsInvalid} onClick={submit}>{(busy || parsing) && <span className="spinner" />}{ctaLabel}{!busy && !parsing && <ArrowRight size={16} />}</button>
          </div></div>
        </> : <>
          <div className="result-head">
            <h1 className={session.raw.length > 30 ? 'long' : undefined}>{requestName}</h1>
            <div className="result-summary">
              <div className="result-summary-copy">
                <div className="mini-tags">{category === 'music' && session.years && <span>{yearLabel(session.years)}</span>}{session.conditions.tags.map(t => <span key={t}>{t}</span>)}{session.conditions.excluded.map(t => <span className="excluded-tag" key={t}>{t} 제외</span>)}{!conditionCount && !(category === 'music' && session.years) && <span>{hasTaste(store.profiles[category]) ? '평소 취향 기준' : '취향·조건 없음'}</span>}</div>
                <ConditionNotes raw={session.raw} category={category} conditions={session.conditions} folded />
              </div>
              <div className="result-actions">
                {category === 'music' && <button className="text-button" disabled={busy || results.length === 0} onClick={() => setPlaylistOpen(true)}><ListMusic size={14} /> {results.length}곡 묶어 보기</button>}
                <button className="text-button" disabled={busy || results.length === 0} onClick={() => share({ title: requestName, items: results.map(r => r.item), conditions: conditionLabels(session.conditions) })}><Share2 size={14} /> 공유</button>
                <button className="text-button" disabled={busy} onClick={() => { setStep('input'); setRequestError(false); }}>조건 바꾸기</button>
              </div>
            </div>
          </div>
          {session.quality?.engine !== 'ai' && <ParseNotice ai={session.editor?.ai} raw={session.raw} hasConditions={conditionCount > 0} />}
          {!hasTaste(store.profiles[category]) && results.length > 0 && <p className="taste-hint">입력한 상황을 기준으로 골랐어요.{showLikeHint && ' 마음에 드는 항목은 더보기에서 취향에 더할 수 있어요.'}</p>}
          {familiarCount > 0 && <span className="result-mix">새로운 {category === 'food' ? '메뉴' : '곡'} {results.length - familiarCount} · 내 취향 {familiarCount}</span>}
          {results.length < (category === 'food' ? 3 : 5) && session.quality?.engine === 'ai' && <div className="notice warning"><Info size={18} /><div><strong>AI가 {results.length}{category === 'music' ? '곡' : '개'}만 골랐어요.</strong><p>조건에 맞지 않거나 이미 본 항목을 걸러낸 결과예요. 다른 추천 보기로 더 받을 수 있어요.</p></div></div>}
          {results.length < (category === 'food' ? 3 : 5) && session.quality?.engine !== 'ai' && <div className="notice warning"><Info size={18} /><div><strong>{results.length ? '조건에 맞는 후보가 조금 부족해요.' : '지금 조건에 맞는 후보가 없어요.'}</strong><p>등록 데이터에서 필수 제외·장기 비선호·이번 요청 제외를 적용한 후보는 {candidateStatus.count}개예요. 필수 제외는 자동으로 완화하지 않아요.</p><button className="text-button" onClick={() => setStep('input')}>조건 조정하기 <ArrowRight size={14} /></button>{session.excludedIds.length > 0 && <button className="text-button" onClick={() => restoreTemporary(session.excludedIds[session.excludedIds.length - 1])}>마지막으로 제외한 항목 되돌리기</button>}</div></div>}
          {session.source === 'local' && apiEnabled() && <div className="notice" role="status"><Info size={18} /><div><strong>기본 추천으로 보여드리고 있어요.</strong><p>추천 서버에 연결하지 못해 이 브라우저의 기본 방식으로 골랐어요. 다른 추천 보기를 누르면 서버 추천을 다시 시도해요.</p></div></div>}
          <QualityNotice session={session} />
          {/* Repeats are judged against what is really left unseen, not by this round's new count alone. */}
          {repeatedCount > 0 && <div className="notice" role="status"><Info size={18} /><div>{unseenLeft === 0 ? <><strong>{session.batchNewCount === 0 ? '새로운 후보를 모두 살펴봤어요.' : `새 후보 ${session.batchNewCount}개 + 이전 후보 ${repeatedCount}개`}</strong><p>조건에 맞는 후보를 모두 보여드려서 이전 후보를 다시 보여드려요. 조건을 바꾸거나 새 요청을 시작할 수 있어요.</p></>
            : <><strong>이전에 본 후보 {repeatedCount}개를 다시 보여드려요.</strong><p>아직 보지 않은 후보가 {unseenLeft}개 남아 있어요. 다른 추천 보기로 이어서 볼 수 있어요.</p></>}</div></div>}
          {offTopicCount > 0 && <div className="notice" role="status"><Info size={18} /><div><strong>고른 조건({session.conditions.tags.join(' · ')})에 맞는 새 후보가 부족해요.</strong><p>{offTopicCount === results.length ? '이번 후보는 모두' : `이번 후보 중 ${offTopicCount}개는`} 등록 특징에 고른 조건이 없어요. 카드의 조건 확인에서 차이를 볼 수 있어요.</p></div></div>}
          {/* Always on screen, so touch and keyboard users get it too. Exclusions only go as far as the registered data. */}
          {category === 'food' && session.quality?.engine === 'ai' && session.conditions.excluded.length > 0 && <div className="notice warning" role="status"><Info size={18} /><div><strong>제외 조건은 AI가 추정한 재료로 확인했어요.</strong><p>실제 재료와 다를 수 있으니, 알레르기가 있다면 주문 전에 꼭 확인해주세요.</p></div></div>}
          {/* Said once for the whole list, when the checks have settled; the slot stays so the sentence is announced as it appears. */}
          {category === 'music' && <div role="status">{unconfirmedSongs > 0 && !results.some(r => songChecks[r.item.id] === 'checking') && <p className="song-summary">{results.length}곡 중 {unconfirmedSongs}곡은 곡 정보를 확인하지 못했어요</p>}</div>}
          <div className={`result-grid ${category}`}>{results.map(r => itemCard(r.item, r))}</div>
          {results.length > 0 && (hasUntagged || session.conditions.excluded.length > 0) && <p className="check-legend">
            {hasUntagged && <span className="when-open">미등록은 데이터에 그 특징이 없다는 뜻이고, 맞지 않는다는 뜻은 아니에요. </span>}
            {session.conditions.excluded.length > 0 && <>{category === 'food' ? '재료·특징 제외는 등록된 정보를 기준으로 적용했어요.' : '제외는 등록된 곡 정보를 기준으로 적용했어요.'}</>}
          </p>}
          {requestError && <div className="error-box" role="alert">{requestError === 'server' ? <><strong>추천 서버에 연결하지 못했어요.</strong><p>아래 버튼으로 다시 시도하거나 기본 방식으로 추천받을 수 있어요.</p><button className="text-button" disabled={busy} onClick={() => run(true, true, true)}>기본 추천으로 보기 <ArrowRight size={14} /></button></> : '재추천을 완료하지 못했어요. 아래 버튼으로 다시 시도해주세요.'}</div>}
          <p className="pick-note">{category === 'food' ? '하나를 고르면' : '오늘의 곡을 고르면'} 추천 기록에 남아요.</p>
          <div className="reroll-panel">
            {allPinned && <p>모든 후보를 고정했어요. 하나 이상 고정을 해제하면 다시 추천할 수 있어요.</p>}
            <button className="button secondary" disabled={busy || results.length === 0 || allPinned} onClick={() => run(true)}>{busy ? <span className="spinner" /> : <RefreshCw size={16} />}{busy ? '다른 추천을 고르는 중' : '같은 조건으로 다시 추천'}</button>
          </div>
          {session.excludedIds.length > 0 && <div className="temporary-exclusions"><span>이번 요청에서만 제외</span>{session.excludedIds.map(id => <button key={id} onClick={() => restoreTemporary(id)}>{resolveItem(items, id)?.name || id}<X size={12} /></button>)}</div>}
          <div className="new-session-link"><button className="text-button" onClick={() => start(category, '', true)}>다른 상황으로 추천받기</button></div>
          <div className={`comparison-toolbar ${(session.compareIds?.length || 0) > 0 ? 'active' : ''}`}>
            <span><Columns2 size={16} /> 비교 {session.compareIds?.length || 0}/3{session.pinnedIds?.length ? ` · 고정 ${session.pinnedIds.length}개` : ''}</span>
            <button className="text-button" onClick={()=>setSession(s=>({...s,compareIds:[]}))}>비교 선택 비우기</button>
            <button className="button primary" disabled={results.filter(r=>session.compareIds?.includes(r.item.id)).length<2} onClick={()=>setCompareOpen(true)}>선택한 후보 비교</button>
          </div>
        </>}
      </>}

      {page === 'complete' && completed?.selected && (() => { const chosen = completed.selected.result.item, song = chosen.category === 'music' ? songLink(chosen.id) : undefined; return <div className="completion">
        <div className="completion-art"><ItemArt item={chosen} size="hero" />{chosen.category === 'music' && <PreviewButton item={chosen} size="large" />}</div>
        <div className="completion-body">
        <h1>선택을 기록했어요</h1>
        <section className="completion-panel">
          <div className={`chosen-summary ${chosen.category}`}><div className="item-title"><h2>{chosen.name}</h2><p className="item-subtitle">{chosen.subtitle}</p></div></div>
          <div className="next-actions" role="group" aria-label="다음 할 일">
            {chosen.category === 'food' ? <>
              <a className="button primary" href={mapSearch(chosen)} target="_blank" rel="noopener noreferrer"><MapPin size={17} />네이버 지도에서 {chosen.name} 검색 (새 탭)</a>
              <a className="button secondary" href={recipeSearch(chosen)} target="_blank" rel="noopener noreferrer"><BookOpen size={17} />만개의레시피에서 레시피 검색 (새 탭)</a>
              <p className="small muted">검색 결과예요. 판매 여부·가격·영업·배달 가능 여부는 각 서비스에서 확인해주세요.</p>
            </> : <>
              {song && <a className="button primary" href={song} target="_blank" rel="noopener noreferrer"><Play size={17} fill="currentColor" />Apple Music에서 듣기 (새 탭)</a>}
              <a className={`button ${song ? 'secondary' : 'primary'}`} href={youtubeSearch(chosen)} target="_blank" rel="noopener noreferrer" aria-label="YouTube에서 찾기 (새 탭)"><Search size={17} />YouTube에서 찾기 (새 탭)</a>
              {!song && <p className="small muted">확인된 곡 링크가 없어 검색으로 연결해요.</p>}
            </>}
          </div>
          <div className="reasons"><p><b>평소 취향</b>{completed.selected.result.tasteReason}</p><p><b>이번 상황</b>{completed.selected.result.contextReason}</p>{completed.selected.result.contrast && <p><b>이 후보의 특징</b>{completed.selected.result.contrast}</p>}</div>
          <p className="completion-context">당시 상황: {completed.raw}</p>
          <div className="mini-tags">{completed.conditions.tags.map(t=><span key={t}>{t}</span>)}{completed.conditions.excluded.map(t=><span key={t}>{t} 제외</span>)}</div>
          {!store.profiles[chosen.category].selected.includes(chosen.id) && <button className="text-button like-chosen" onClick={() => likeItem(chosen)}><ThumbsUp size={15} />내 취향에 추가하고 다음 추천에 반영</button>}
          <ReviewForm key={completed.id} entry={completed} title="지금 느낌은 어때요?" intro="기록용이에요. 다음 추천과 평소 취향에는 반영하지 않아요. 나중에 추천 기록에서도 고칠 수 있어요." persisted={!storageWarning} onSave={(rating, note) => { setStore(s => ({ ...s, history: s.history.map(h => h.id === completed.id ? reviewSelection(h, rating, note) : h) })); notify('느낌을 기록했어요.'); }} />
          <div className="card-actions"><button className="button secondary" onClick={()=>navigate('history')}>추천 기록 보기</button><div className="button-row"><button className="button secondary" onClick={() => share({ title: '오늘의 선택', items: [chosen], conditions: conditionLabels(completed.conditions) })}><Share2 size={16} />공유</button><button className="button secondary" onClick={()=>setHistoryPreview(completed)}>선택 변경</button><button className="button secondary" onClick={()=>start(completed.category,'',true)}>다른 상황으로 추천받기</button></div></div>
        </section>
        </div>
      </div>; })()}

      {page === 'admin' && <AdminReports token={account?.token} onBack={() => navigate('taste')} />}
      {page === 'type' && <TasteType results={store.tasteTypes || {}} likedItems={{ food: store.profiles.food.selected.flatMap(id => { const i = resolveItem(items, id); return i ? [i] : []; }), music: store.profiles.music.selected.flatMap(id => { const i = resolveItem(items, id); return i ? [i] : []; }) }}
        onSave={(c, result) => setStore(s => ({ ...s, tasteTypes: { ...s.tasteTypes, [c]: result } }))} onBack={() => navigate(apiEnabled() ? 'lab' : 'taste')} backLabel={apiEnabled() ? '실험실로' : '내 취향으로'} owner={store.name === '취향 탐험가' ? '' : store.name} onNotice={notify} onEditTaste={editTaste}
        onRecommend={(c, code) => { const base = { ...newSession(c), ...requestForType(c, code) }; start(c, base.raw, true); setSession(base); setStep('input'); }} />}
      {page === 'lab' && <Lab onTasteType={() => navigate('type')} key={labCategory} category={labCategory} profile={store.profiles[labCategory]} items={items} onCategory={c => { setLabCategory(c); try { sessionStorage.setItem('nowrecommend-lab-category', c); } catch { /* fine */ } }} onEditTaste={() => editTaste(labCategory)} onHome={() => navigate('home')} />}
      {page === 'favorites' && <Favorites ids={store.favorites} card={itemCard} onRecommend={recommendSaved} onStart={start}/>}
      {page === 'history' && <>
        <div className="page-heading with-action"><h1>추천 기록 {store.history.length > 0 && <span className="count">{store.history.length}</span>}</h1><button className="button secondary compact" onClick={() => setManualOpen(true)}><PenLine size={15} />직접 기록</button></div>
        {tabFilter}
        {store.history.length > 0 && <div className="history-tools">
          <label className="find-field"><Search size={16} /><input type="search" value={historyQuery} onChange={e => setHistoryQuery(e.target.value)} placeholder="문장이나 메뉴·곡 이름으로 찾기" aria-label="기록 검색" /></label>
          <button className={`button secondary compact${calendarOpen ? ' active' : ''}`} aria-pressed={calendarOpen} onClick={() => setCalendarOpen(open => !open)}><CalendarDays size={15} />달력</button>
          {historyDay && <button className="chip selected" onClick={() => setHistoryDay('')} aria-label={`${dayLabel(historyDay)} 필터 해제`}>{dayLabel(historyDay)}<X size={13} /></button>}
        </div>}
        {calendarOpen && store.history.length > 0 && <HistoryCalendar year={calendarMonth.year} month={calendarMonth.month} entries={store.history.filter(h => filter === 'all' || h.category === filter)} selectedDay={historyDay} onSelect={setHistoryDay} onMonth={(year, month) => setCalendarMonth({ year, month })} />}
        {historyGroups(shownHistory).map(([day, entries]) => <section className="history-group" key={day}>
          <h2>{day}</h2>
          <div className="history-list">{entries.map(h => <article className="history-row" key={h.id}>
          {(() => { const shown = h.selected?.result.item || h.rounds.at(-1)?.results[0]?.item; return shown ? <ItemArt item={shown} size="thumb" /> : <span className={`small-icon ${h.category}`}>{h.category === 'food' ? <Utensils size={18} /> : <Headphones size={18} />}</span>; })()}
          <div className="history-content">
            <span>{categoryLabel[h.category]} · {new Intl.DateTimeFormat('ko-KR', { hour: 'numeric', minute: 'numeric', timeZone: 'Asia/Seoul' }).format(new Date(h.date))}</span>
            <button className="history-title" onClick={() => setHistoryPreview(h)}>{h.raw}</button>
            <p>{h.selected ? <><b className="chosen">선택함</b> {h.selected.result.item.name}</> : h.legacy ? '이전 버전 기록 · 최종 선택 미등록' : h.rounds.at(-1)?.results.length ? <><b className="only-seen">추천만 받음</b> {h.rounds.at(-1)!.results.map(r=>r.item.name).join(' · ')}</> : '조건에 맞는 결과 없음'}</p>
          </div>
          <button className="button secondary compact" onClick={() => reuse(h)}>같은 조건으로 새 추천</button>
          <button className="icon-button" aria-label={`${h.raw} 기록 삭제`} onClick={() => { setDeleteId(h.id); setDialog('deleteHistory'); }}><Trash2 size={16} /></button>
        </article>)}</div></section>)}
        {shownHistory.length === 0 && store.history.length > 0 && <div className="empty-state"><span><Search size={30} /></span><h3>맞는 기록이 없어요.</h3><p>검색어나 날짜, 분야를 바꿔보세요.</p><button className="button secondary" onClick={() => { setHistoryQuery(''); setHistoryDay(''); setFilter('all'); }}>조건 지우기</button></div>}
        {store.history.length === 0 && <div className="empty-state"><span><Clock3 size={30} /></span><h3>아직 기록이 없어요.</h3><p>추천받은 상황과 결과를 여기에서 다시 볼 수 있어요.</p><button className="button primary" onClick={() => start(filter === 'music' ? 'music' : 'food')}>추천 시작하기 <ArrowRight size={16} /></button></div>}
      </>}
      {page === 'taste' && <>
        <div className="page-heading"><h1>내 취향</h1><p>취향은 다음 추천의 기준이 되고, 즐겨찾기는 다시 보고 싶은 항목을 모아 둬요.</p></div>
        {stats.chosen > 0 && <section className="stats-row" aria-label="내 기록 요약">
          <div className="stat-card sun"><CalendarDays size={18} /><b>{stats.thisMonth}번</b><span>이번 달에 골랐어요{stats.chosen !== stats.thisMonth ? ` · 전체 ${stats.chosen}번` : ''}</span></div>
          <div className="stat-card food"><Utensils size={18} /><b>{stats.byCategory.food} · {stats.byCategory.music}</b><span>음식 · 음악 선택 횟수</span></div>
          {stats.traits.length > 0 && <div className="stat-card music"><Sparkles size={18} /><b>{stats.traits.join(' · ')}</b><span>자주 고른 특징</span></div>}
          {stats.slot && <div className="stat-card"><Clock3 size={18} /><b>{slotSentence(stats.slot)}</b><span>선택한 시각 기준</span></div>}
          {stats.satisfied && <div className="stat-card"><SmilePlus size={18} /><b>{stats.satisfied.good} / {stats.satisfied.rated}</b><span>느낌을 남긴 선택 중 만족</span></div>}
        </section>}
        <div className="taste-grid">{(['food', 'music'] as Category[]).map(c => <section className="taste-panel" key={c}>
          <div className="section-heading"><h2>{categoryLabel[c]}</h2><button className="text-button" onClick={() => editTaste(c)}>{hasTaste(store.profiles[c]) ? '편집하기' : '등록하기'}</button></div>
          {store.profiles[c].selected.length > 0 ? <div className="taste-tiles">{store.profiles[c].selected.map(id => { const i = resolveItem(items, id); return i ? <span className="taste-tile" key={id}><ItemArt item={i} size="tile" /><small>{i.name}</small>{store.profiles[c].reasons?.[id]?.trim() && <small className="taste-reason">{store.profiles[c].reasons![id]}</small>}</span> : null; })}</div>
            : <p>{c === 'food' ? '자주 찾는 메뉴를 알려주세요.' : '좋아하는 곡이나 분위기를 골라주세요.'}</p>}
          {!!store.profiles[c].custom?.length && <ul className="custom-tastes">{store.profiles[c].custom!.map(t => <li key={t.id}><b>{t.name}</b>{t.reason?.trim() && <small>{t.reason}</small>}</li>)}</ul>}
          {store.profiles[c].tags.length > 0 && <div className="mini-tags">{store.profiles[c].tags.map(t => <span key={t}>{t}</span>)}</div>}
          {store.profiles[c].disliked.length > 0 && <><h4>추천에서 뺀 항목 <span>{store.profiles[c].disliked.length}</span></h4>
          <div className="chips">{store.profiles[c].disliked.map(id => <button className="chip exclude selected" key={id} aria-label={`${resolveItem(items, id)?.name} 비선호 해제`} onClick={() => { setStore(s => ({ ...s, profiles: { ...s.profiles, [c]: { ...s.profiles[c], disliked: s.profiles[c].disliked.filter(v => v !== id) } } })); notify('장기 비선호를 해제했어요.'); }}>{resolveItem(items, id)?.name || id}<X size={13} /></button>)}</div></>}
          {(hasTaste(store.profiles[c]) || store.profiles[c].disliked.length > 0) && <button className="text-button danger reset-taste" onClick={() => { setCategory(c); setDialog('resetTaste'); }}>이 분야 취향 초기화</button>}
        </section>)}</div>
        <div className="my-links">
          <button className="list-row" onClick={() => navigate('history')}><span className="list-copy"><b>추천 기록</b><small>지난 추천과 선택 {store.history.length}개</small></span><ChevronRight size={18} /></button>
          <button className="list-row" onClick={() => { setNameDraft(store.name); setDialog('account'); }}><span className="list-copy"><b>프로필·화면 설정</b><small>이름, 테마, 데이터 백업</small></span><ChevronRight size={18} /></button>
          {account?.user.isAdmin && <button className="list-row" onClick={() => navigate('admin')}><span className="list-copy"><b>오류 신고 관리</b><small>사용자가 보낸 사진·정보 오류 확인</small></span><ChevronRight size={18} /></button>}
          <button className="list-row" onClick={() => navigate('type')}><span className="list-copy"><b>취향 유형 테스트</b><small>음식·음악 취향을 네 글자로, 공유 카드까지</small></span><ChevronRight size={18} /></button>
          {/* Experiments live off the main flow (#/lab); the home screen stays on recommending. */}
          {apiEnabled() && <button className="list-row" onClick={() => navigate('lab')}><span className="list-copy"><b>AI 실험실</b><small>후보 비교와 취향 유형 테스트</small></span><ChevronRight size={18} /></button>}
        </div>
      </>}
      {page === 'login' && <div className="login-panel">
        <div className="login-body">
        <h1>{account ? `${account.user.name}님, 로그인되어 있어요.` : '로그인'}</h1>
        <p>{account ? '계정의 취향·즐겨찾기·기록이 이 브라우저와 동기화돼요.' : '취향과 기록을 저장해 다른 기기에서도 이어 쓸 수 있어요.'}</p>
        {account ? <div className="card-actions"><button className="button primary" onClick={() => navigate('home')}>홈으로 <ArrowRight size={16} /></button><button className="button secondary" onClick={() => { signOut(); document.getElementById('main-content')?.focus({ preventScroll: true }); }}><LogOut size={16} />로그아웃</button></div>
          : <AuthPanel online={apiEnabled()} initialName={store.name === '취향 탐험가' ? '' : store.name} onSuccess={signIn} onGuest={() => navigate('home')} />}
        </div>
        <div className="login-wall" aria-hidden="true">{showcase('food', 3).flatMap((f, n) => [f, showcase('music', 3)[n]]).filter(Boolean).map(i => <ItemArt key={i.id} item={i} size="tile" />)}</div>
      </div>}
      </div>
    </main>
    <nav className="tabbar" aria-label="하단 메뉴">{allNav.filter(n => n.page !== 'history').map(n => <button key={n.label} aria-label={n.label} aria-current={navActive(n) ? 'page' : undefined} className={`tab ${navActive(n) ? 'active' : ''}`} onClick={() => goNav(n)}><n.icon size={21} /><span aria-hidden="true">{shortLabel[n.label]}</span>{n.page === 'favorites' && store.favorites.length > 0 && <span className="tab-count" aria-hidden="true">{store.favorites.length}</span>}</button>)}</nav>
    {toast && !reportItem && !dialog && !feedbackItem && !historyPreview && !detail && !presetPreview && !savePresetOpen && !compareOpen && <div className="toast" role="status" onMouseEnter={()=>setToastPaused(true)} onMouseLeave={()=>setToastPaused(false)} onFocus={()=>setToastPaused(true)} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))setToastPaused(false);}}><CheckCheck size={18} /><span>{toast.message}</span>{toast.undo && <button onClick={() => { toast.undo?.(); dismissToast(); }}>되돌리기</button>}<button className="icon-button" aria-label="알림 닫기" onClick={dismissToast}><X size={15} /></button></div>}
    {feedbackItem && <Modal title="어떤 이유로 바꾸고 싶으세요?" onClose={() => setFeedbackItem(null)}><p className="modal-description"><b>{feedbackItem.name}</b>에 대한 의견을 어디까지 반영할지 골라주세요.</p><button className="feedback-option" onClick={() => applyFeedback('session')}><span className="small-icon food"><Clock3 size={21} /></span><span><b>이번 요청에서 제외</b><small>이번 요청에서만 빼고 다른 항목을 추천해요.<br />새로운 상황으로 시작하면 다시 만날 수 있어요.</small></span><ChevronRight size={19} /></button><button className="feedback-option" onClick={() => applyFeedback('long')}><span className="small-icon music"><SlidersHorizontal size={21} /></span><span><b>원래 내 취향이 아님</b><small>이 항목을 장기 비선호에 저장해요.<br />다음 요청에서도 제외하며, 내 취향에서 해제할 수 있어요.</small></span><ChevronRight size={19} /></button><button className="button secondary full-width" onClick={() => setFeedbackItem(null)}>취소</button></Modal>}
    {historyPreview && <Modal title="그때의 추천" onClose={() => setHistoryPreview(null)}><HistoryDetails entry={historyPreview} persisted={!storageWarning} onSelect={(result,roundId)=>reviseSelection(historyPreview,result,roundId)} onCancel={()=>reviseSelection(historyPreview)} onReview={(rating,note)=>{const next=reviewSelection(historyPreview,rating,note);setStore(s=>({...s,history:s.history.map(h=>h.id===next.id?next:h)}));setHistoryPreview(next);}}/><button className="button primary full-width" onClick={() => reuse(historyPreview)}>같은 조건으로 다시 추천 <ArrowRight size={16} /></button></Modal>}
    {presetPreview && <Modal title="조건을 바꿀까요?" onClose={()=>setPresetPreview(null)}><p className="modal-description">작성 중인 조건을 ‘{presetPreview.name}’으로 바꿀까요?</p><ConditionsSummary conditions={presetPreview.conditions}/><div className="modal-actions"><button data-safe-focus className="button secondary" onClick={()=>setPresetPreview(null)}>취소</button><button className="button primary" onClick={()=>applyQuickCondition(presetPreview)}>이 조건 적용</button></div></Modal>}
    {reportItem && <ReportDialog item={reportItem} token={account?.token} onClose={() => setReportItem(null)} onSent={() => { setReportedIds(ids => [...ids, reportItem.id]); setReportItem(null); notify('신고를 보냈어요. 확인 후 고칠게요.'); }} />}
    {detail && <Modal title={detail.item.name} onClose={()=>setDetail(null)}><ItemDetails item={detail.item} reasons={detail.reasons} conditions={session.conditions} onReport={apiEnabled() ? () => { const it = detail.item; setDetail(null); setReportItem(it); } : undefined}/></Modal>}
    {manualOpen && <Modal title="직접 기록" onClose={() => setManualOpen(false)}><ManualRecord items={items} category={filter === 'all' ? 'food' : filter} onSave={entry => { setStore(s => ({ ...s, history: addManual(s.history, entry) })); setManualOpen(false); notify(`${entry.selected!.result.item.name}을(를) 기록했어요.`); }} /></Modal>}
    {playlistOpen && <Modal title="이번 추천 플레이리스트" onClose={() => setPlaylistOpen(false)}><Playlist results={results}
      onCopy={() => navigator.clipboard.writeText(`${shareText({ title: requestName, items: results.map(r => r.item) })}\n${appAddress()}`).then(() => notify('곡 목록을 복사했어요.'), () => notify('이 환경에서는 복사할 수 없어요.'))}
      onShare={() => void share({ title: requestName, items: results.map(r => r.item), conditions: conditionLabels(session.conditions) })} /></Modal>}
    {compareOpen && <Modal title="후보 비교" onClose={()=>setCompareOpen(false)}><Comparison results={results.filter(r=>session.compareIds?.includes(r.item.id))} conditions={session.conditions} onChoose={r=>{setCompareOpen(false);choose(r);}}/></Modal>}
    {savePresetOpen && <Modal title="내 조건 저장" onClose={()=>setSavePresetOpen(false)}><ConditionsSummary conditions={session.conditions}/><form onSubmit={e=>{e.preventDefault();if(!presetName.trim())return;const preset:Preset={id:crypto.randomUUID(),category:session.category,name:presetName.trim(),conditions:structuredClone(session.conditions)};setStore(s=>({...s,presets:[...(s.presets || []),preset]}));setSavePresetOpen(false);notify('조건 프리셋을 저장했어요.');}}><label className="field-title" htmlFor="preset-name">프리셋 이름</label><input id="preset-name" value={presetName} required maxLength={30} onChange={e=>setPresetName(e.target.value)}/><button className="button primary">프리셋 저장</button></form></Modal>}
    {dialog === 'about' && <Modal neutral title="지금 추천을 먼저 경험해보세요." onClose={() => setDialog(null)}><p className="modal-description">취향 등록부터 조건 수정, 추천과 피드백까지 직접 사용해볼 수 있는 체험 버전이에요.</p><div className="about-list"><p><Check size={17} /> 음식은 {items.filter(i=>i.category==='food').length}개 등록 데이터에서 골라요. {apiEnabled() ? `음악은 AI가 아는 곡 중에서 직접 골라요(등록 곡 ${items.filter(i=>i.category==='music').length}곡은 취향 등록에 써요).` : `음악 ${items.filter(i=>i.category==='music').length}곡의 예시 데이터로 추천해요.`}</p><p><Check size={17} /> 가격·예산·배달 가능 여부는 다루지 않아요. 취향·상황·제외 조건으로 골라요.</p><p><Check size={17} /> 문장에서 조건을 찾아요. {apiEnabled() ? '규칙이 놓친 표현은 AI가 함께 읽어요.' : '알려진 표현만 읽으니 놓친 조건은 직접 골라주세요.'}</p><p><Check size={17} /> 취향·즐겨찾기·최근 50개 기록은 이 브라우저에 저장해요.</p><p><Check size={17} /> {apiEnabled() ? '로그인하면 취향·기록이 계정에 저장되어 다른 기기에서도 이어 써요. ' : ''}실제 주문·음원 재생은 포함하지 않아요. 지도·레시피·음악 서비스 검색으로 연결해요.</p></div><div className="demo-tools"><h4>실패 화면도 살펴볼까요?</h4><p>다음 추천 요청 한 번에 오류 안내를 표시해요. 재시도와 수동 진행을 확인할 수 있어요.</p><button className="button secondary full-width" onClick={() => { setFailNext(true); setDialog(null); notify('다음 추천 요청에서 실패 안내를 체험할 수 있어요.'); }}>다음 추천 실패 체험하기</button></div></Modal>}
    {dialog === 'account' && <Modal neutral title="설정" onClose={() => setDialog(null)}>
      <div className="filter-tabs settings-tabs" role="group" aria-label="설정 구역">{([['profile', '프로필'], ['screen', '화면'], ['data', '데이터 관리']] as const).map(([id, name]) => <button key={id} aria-pressed={settingsTab === id} className={settingsTab === id ? 'active' : ''} onClick={() => setSettingsTab(id)}>{name}</button>)}</div>
      {settingsTab === 'profile' && <>
        {account ? <div className="account-card"><span className="top-avatar signed-in" aria-hidden="true"><b>{account.user.name.slice(0, 1)}</b></span><div className="list-copy"><b>{account.user.name}</b><small>{account.user.email}</small></div><span className={`sync-state ${syncState}`} role="status" tabIndex={-1}>{syncState === 'saving' ? <><span className="spinner" />저장 중</> : syncState === 'failed' ? <><CloudOff size={15} />저장 실패</> : <><Cloud size={15} />{syncState === 'saved' ? '계정에 저장됨' : '동기화 켜짐'}</>}</span>{syncState === 'failed' && <button className="text-button" onClick={e => { e.currentTarget.parentElement?.querySelector<HTMLElement>('.sync-state')?.focus(); setSyncAttempt(n => n + 1); }}>다시 저장</button>}</div>
          : <p className="modal-description">{apiEnabled() ? '지금은 취향과 기록이 이 브라우저에만 저장돼요. 로그인하면 다른 기기에서도 이어 쓸 수 있어요.' : '취향과 기록은 이 브라우저에만 저장돼요.'}</p>}
        {!account && apiEnabled() && <button className="button primary full-width" onClick={() => { setDialog(null); navigate('login'); }}><LogIn size={17} />로그인 · 회원가입</button>}
        <form onSubmit={e => { e.preventDefault(); setStore(s => ({ ...s, name: nameDraft.trim() || '취향 탐험가' })); setDialog(null); notify('이름을 변경했어요.'); }}><label className="field-title" htmlFor="account-name">이름</label><input id="account-name" value={nameDraft} maxLength={16} required onChange={e => setNameDraft(e.target.value)} /><button className="button secondary full-width">이름 변경</button></form>
        {account && <div className="account-links"><button onClick={signOut}><LogOut size={17} /> 로그아웃 <small>(이 브라우저의 데이터는 남아요)</small></button><button className="danger" onClick={() => { setDeletePassword(''); setDeleteError(''); setDialog('deleteAccount'); }}><Trash2 size={17} /> 계정과 계정 데이터 삭제</button></div>}
      </>}
      {settingsTab === 'screen' && <AppearanceSettings value={store.appearance} onChange={appearance=>setStore(s=>({...s,appearance}))}/>}
      {settingsTab === 'data' && <>
        <DataManagement store={store} damagedRaw={storageBlocked?loaded.raw:undefined} onImport={importStore} onReset={scope=>{setStore(s=>({...s,[scope]:scope==='profiles'?emptyStore().profiles:[]}));if(scope==='profiles'){setActive(false);setSession(newSession(category));setDraftProfile(emptyStore().profiles[category]);}notify('선택한 데이터를 초기화했어요.');}}/>
        <div className="account-links"><button className="danger" onClick={() => setDialog('reset')}><Trash2 size={17} /> 이 브라우저의 데이터 모두 초기화</button></div>
      </>}
    </Modal>}
    {dialog === 'deleteAccount' && account && <Modal neutral title="계정을 삭제할까요?" onClose={() => setDialog(null)}><p className="modal-description">계정과 계정에 저장된 취향·즐겨찾기·기록을 서버에서 지워요. 이 브라우저의 데이터는 남아 있고, 되돌릴 수 없어요.</p><form onSubmit={async e => { e.preventDefault(); setDeleteError(''); try { await deleteAccount(account.token, deletePassword); writeAccount(null); setAccount(null); setDialog(null); notify('계정을 삭제했어요. 이 브라우저의 데이터는 그대로예요.'); } catch (err) { setDeleteError(err instanceof ApiError && err.status === 401 ? '비밀번호가 맞지 않아요.' : '계정을 삭제하지 못했어요. 잠시 후 다시 시도해주세요.'); } }}><label className="field-title" htmlFor="delete-password">비밀번호 확인</label><input id="delete-password" type="password" autoComplete="current-password" required minLength={8} value={deletePassword} onChange={e => setDeletePassword(e.target.value)} />{deleteError && <div className="error-box" role="alert">{deleteError}</div>}<div className="modal-actions"><button type="button" data-safe-focus className="button secondary" onClick={() => setDialog(null)}>취소</button><button className="button danger-button" disabled={deletePassword.length < 8}>계정 삭제</button></div></form></Modal>}
    {['reset', 'deleteHistory', 'resetTaste'].includes(dialog || '') && <Modal neutral title={dialog === 'reset' ? '체험 데이터를 초기화할까요?' : dialog === 'resetTaste' ? `${categoryLabel[category]} 취향을 초기화할까요?` : '이 추천 기록을 삭제할까요?'} onClose={() => setDialog(null)}><p className="modal-description">{dialog === 'reset' ? '이 브라우저의 취향, 즐겨찾기와 추천 기록을 모두 삭제해요.' : dialog === 'resetTaste' ? '이 분야의 선호 항목과 장기 비선호를 삭제해요. 즐겨찾기와 기록은 유지해요.' : '삭제한 기록은 복구할 수 없어요. 취향과 즐겨찾기는 유지해요.'}</p><div className="modal-actions"><button data-safe-focus className="button secondary" onClick={() => setDialog(null)}>취소</button><button className="button danger-button" onClick={() => { if (dialog === 'reset') { if (!clearDamagedStore()) { notify('데이터를 삭제하지 못했어요.'); setDialog(null); return; } setStorageBlocked(false); setStore(emptyStore()); setSession(newSession()); setActive(false); setToast(null); navigate('home'); } else if (dialog === 'resetTaste') { setStore(s => ({ ...s, profiles: { ...s.profiles, [category]: { selected: [], tags: [], disliked: [] } } })); } else setStore(s => ({ ...s, history: s.history.filter(h => h.id !== deleteId) })); setDialog(null); notify('삭제했어요.'); }}>삭제하기</button></div></Modal>}
  </div>;
}
