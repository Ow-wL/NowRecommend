import { ArrowLeft, RotateCw, WifiOff } from 'lucide-react';

/** In place of the admin console when its screen could not be fetched (2026-11-29). The console is loaded on demand
 *  (App.tsx), so a first visit without a connection, or a file gone after a release, used to end at the app's error
 *  screen. Loaded with the app itself, not with the console, so it is there offline. */
export function AdminUnavailable({ onExit }: { onExit: () => void }) {
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  return <main className="admin-loading admin-unavailable" role="alert">
    <WifiOff size={28} aria-hidden="true" />
    <h1>{offline ? '연결이 없어요' : '관리 화면을 불러오지 못했어요'}</h1>
    <p>{offline ? '관리 화면은 인터넷에 연결돼 있을 때 열 수 있어요. 연결된 뒤 다시 시도해주세요.' : '잠시 뒤 다시 시도해주세요. 계속 안 되면 페이지를 새로 고쳐주세요.'}</p>
    <div className="admin-unavailable-actions">
      <button type="button" className="button primary compact" onClick={() => window.location.reload()}><RotateCw size={16} aria-hidden="true" /> 다시 시도</button>
      <button type="button" className="button secondary compact" onClick={onExit}><ArrowLeft size={16} aria-hidden="true" /> 서비스로 돌아가기</button>
    </div>
  </main>;
}
