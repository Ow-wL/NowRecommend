import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reportError } from '../errors';

/** Around the whole app: an error while drawing the screen would otherwise leave a blank page with no way forward. The
 * person's data is in the browser's storage and is not touched by this; the screen says so, and offers the two ways out. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, _info: ErrorInfo) { reportError('render', error); }
  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="crash-screen" role="alert">
      <h1>화면을 표시하다 문제가 생겼어요</h1>
      <p>취향과 기록은 이 브라우저에 그대로 있어요. 다시 불러오면 대부분 해결돼요.</p>
      <div className="crash-actions">
        <button className="button primary" onClick={() => window.location.reload()}>다시 불러오기</button>
        <button className="button secondary" onClick={() => { window.location.hash = '#/home'; window.location.reload(); }}>홈에서 다시 시작</button>
      </div>
    </main>;
  }
}
