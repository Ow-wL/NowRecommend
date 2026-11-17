import { useEffect, useState } from 'react';
import { Copy, Headphones, Play } from 'lucide-react';
import type { Item } from '../data';
import { agreeYoutube, closeFullPlay, embedAddress, musicApps, openFullPlay, playerStorefront, rememberMusicApp, songWords, useFullPlayOpen, useMusicApp, youtubeAddress, youtubeAgreed, type MusicApp } from '../fullPlay';
import { LEGAL_VERSION } from '../legal';
import { stopPreview } from '../preview';
import { fetchYouTube } from '../api/youtube';
import { ApiError } from '../api/client';
import { youtubeSearch } from '../media';

const panelId = (item: Pick<Item, 'id'>) => `full-play-${item.id}`;
const youtubeId = (item: Pick<Item, 'id'>) => `youtube-play-${item.id}`;

/** Opens Apple Music's player for this song inside the page, or closes it. `link`: the song's Apple Music page.
 * Named for what it does: whether the whole song plays depends on the person's subscription and on Apple. */
export function FullPlayButton({ item, link }: { item: Pick<Item, 'id' | 'name'>; link: string }) {
  const open = useFullPlayOpen(item);
  if (!embedAddress(link)) return null;
  return <button type="button" className="button primary compact" aria-expanded={open} aria-controls={panelId(item)}
    onClick={() => { if (open) closeFullPlay(item.id); else { stopPreview(); openFullPlay(item.id); } }}>
    <Headphones size={16} aria-hidden="true" />{open ? 'Apple Music 플레이어 닫기' : 'Apple Music 플레이어 열기'}</button>;
}

/** The player itself. It is not loaded until it is opened, and it is taken out of the page again when the details close,
 * which stops the music. The frame's attributes are the ones Apple's own embed code carries; its address is built here
 * from a checked song page, never taken from markup someone else wrote. */
export function FullPlayPanel({ item, link }: { item: Pick<Item, 'id' | 'name'>; link: string }) {
  const open = useFullPlayOpen(item);
  const [address, setAddress] = useState<string>();
  useEffect(() => {
    if (!open) { setAddress(undefined); return; }
    let current = true;
    void playerStorefront(link).then(store => { if (current) setAddress(embedAddress(link, store)); });
    return () => { current = false; };
  }, [open, link]);
  useEffect(() => () => closeFullPlay(item.id), [item.id]);
  if (!open) return null;
  return <section id={panelId(item)} className="full-play" aria-label={`${item.name} Apple Music 플레이어`}>
    {address
      ? <iframe title={`${item.name} Apple Music 플레이어`} src={address} height={175} allow="autoplay *; encrypted-media *; fullscreen *; clipboard-write"
          sandbox="allow-forms allow-popups allow-same-origin allow-scripts allow-storage-access-by-user-activation allow-top-navigation-by-user-activation" />
      : <div className="full-play-wait" role="status"><span className="spinner" />플레이어를 여는 중이에요</div>}
    <p className="small muted">Apple Music을 구독 중이면 플레이어의 <b>로그인</b>으로 전곡을 들을 수 있어요(곡에 따라 제공되지 않을 수 있어요). 로그인하지 않으면 30초만 재생돼요. 로그인은 Apple의 창에서 이뤄지고, 지금 추천은 계정 정보를 받지 않아요. 플레이어가 비어 있거나 로그인이 되지 않으면 위의 "Apple Music에서 듣기"로 열어 주세요.</p>
  </section>;
}

/** Opens YouTube's player for this song inside the page, or closes it. The server finds the video when it is opened. */
export function YouTubeButton({ item, primary }: { item: Pick<Item, 'id' | 'name'>; primary: boolean }) {
  const open = useFullPlayOpen(item, 'youtube');
  return <button type="button" className={`button ${primary ? 'primary' : 'secondary'} compact`} aria-expanded={open} aria-controls={youtubeId(item)}
    onClick={() => { if (open) closeFullPlay(item.id); else { stopPreview(); openFullPlay(item.id, 'youtube'); } }}>
    <Play size={16} aria-hidden="true" />{open ? 'YouTube 플레이어 닫기' : 'YouTube로 듣기'}</button>;
}

type Found = { state: 'wait' } | { state: 'found'; address: string } | { state: 'none' } | { state: 'failed'; message: string };
/** YouTube's player. Nothing is asked of the server or YouTube until it is opened; it leaves the page with the details. The
 * frame is YouTube's own embed, in its privacy-enhanced mode (no cookie until the video plays). */
export function YouTubePanel({ item }: { item: Pick<Item, 'id' | 'name' | 'subtitle'> }) {
  const open = useFullPlayOpen(item, 'youtube');
  const [found, setFound] = useState<Found>({ state: 'wait' }), [agreed, setAgreed] = useState(() => youtubeAgreed(LEGAL_VERSION));
  useEffect(() => {
    if (!open || !agreed) { setFound({ state: 'wait' }); return; }
    const controller = new AbortController();
    fetchYouTube(item.id, { signal: controller.signal })
      .then(answer => { const address = youtubeAddress(answer.videoId); setFound(address ? { state: 'found', address } : { state: 'none' }); })
      .catch(error => { if (!controller.signal.aborted) setFound({ state: 'failed', message: error instanceof ApiError && error.kind === 'http' && error.message && !/^HTTP \d+$/.test(error.message) ? error.message : 'YouTube 플레이어를 열지 못했어요. 아래 ‘YouTube에서 찾기’로 열어 주세요.' }); });
    return () => controller.abort();
  }, [open, agreed, item.id]);
  useEffect(() => () => closeFullPlay(item.id), [item.id]);
  if (!open) return null;
  const terms = <><a href="https://www.youtube.com/t/terms" target="_blank" rel="noopener noreferrer">YouTube 이용약관</a>, <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">Google 개인정보처리방침</a></>;
  if (!agreed) return <section id={youtubeId(item)} className="full-play youtube" aria-label={`${item.name} YouTube 플레이어`}>
    <div className="youtube-ask" role="group" aria-labelledby={`${youtubeId(item)}-ask`}>
      <p id={`${youtubeId(item)}-ask`}><b>YouTube 플레이어를 처음 쓰기 전에 확인해 주세요.</b> 이 기능은 YouTube API 서비스로 영상을 찾고 YouTube의 플레이어로 재생해요. 쓰면 {terms}과 이 서비스의 <a href="#/privacy" target="_blank" rel="noopener">개인정보 처리방침</a>(YouTube 항목)에 동의하는 것으로 봐요. 플레이어를 열면 접속 정보가 YouTube(Google)로 가요.</p>
      <div className="card-actions"><button type="button" className="button secondary compact" onClick={() => closeFullPlay(item.id)}>취소</button><button type="button" className="button primary compact" onClick={() => { agreeYoutube(LEGAL_VERSION); setAgreed(true); }}>동의하고 열기</button></div>
    </div>
  </section>;
  return <section id={youtubeId(item)} className="full-play youtube" aria-label={`${item.name} YouTube 플레이어`}>
    {found.state === 'found'
      ? <div className="youtube-frame"><iframe title={`${item.name} YouTube 플레이어`} src={found.address} allow="encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" /></div>
      : found.state === 'wait' ? <div className="full-play-wait" role="status"><span className="spinner" />영상을 찾는 중이에요</div>
      : <div className="full-play-wait" role="status">{found.state === 'none' ? '이 곡을 여기서 재생할 수 있는 영상을 찾지 못했어요.' : found.message} <a href={youtubeSearch(item)} target="_blank" rel="noopener noreferrer">YouTube에서 찾기 (새 탭)</a></div>}
    <p className="small muted">YouTube에서 찾은 영상을 재생해요. 다른 버전이거나 공식 영상이 아닐 수 있어요. 이 플레이어에는 {terms}이 적용돼요.</p>
  </section>;
}

/** The song in the person's own music app: that app's search in a new tab, and the words to paste where the search does
 * not open. The app opened last comes first next time. */
export function MusicApps({ item }: { item: Pick<Item, 'name' | 'subtitle'> }) {
  const mine = useMusicApp(), words = songWords(item);
  const [copied, setCopied] = useState<'' | 'done' | 'failed'>('');
  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(''), 2500); return () => clearTimeout(timer); }, [copied]);
  const copy = async () => { try { await navigator.clipboard.writeText(words); setCopied('done'); } catch { setCopied('failed'); } };
  const link = (app: MusicApp, className: string) =>
    <a key={app.id} className={className} href={app.search(words)} target="_blank" rel="noopener noreferrer" onClick={() => rememberMusicApp(app.id)}>{app.name}에서 찾기 (새 탭)</a>;
  return <div className="music-apps">
    {mine && link(mine, 'button secondary compact')}
    <details>
      <summary>{mine ? '다른 음악 앱' : '내 음악 앱에서 찾기 (멜론 · YouTube Music 등)'}</summary>
      <div className="music-app-list">{musicApps.filter(app => app.id !== mine?.id).map(app => link(app, 'chip small'))}</div>
      <p className="small muted">각 앱의 검색 화면을 열어요. 이 앱들은 다른 사이트 안에서 재생하거나 로그인하는 방법을 제공하지 않아요. 휴대폰에서 검색 화면이 바로 열리지 않으면 제목을 복사해 앱에 붙여 넣어 주세요.</p>
    </details>
    <button type="button" className="text-button" onClick={() => void copy()}><Copy size={14} aria-hidden="true" />제목·가수 복사</button>
    <span className="small muted" role="status">{copied === 'done' ? '복사했어요' : copied === 'failed' ? `복사하지 못했어요: ${words}` : ''}</span>
  </div>;
}
