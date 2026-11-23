import './polyfills';  // first: adds what an older browser lacks before any other module runs
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { installErrorReporting } from './errors';
import './styles.css';
installErrorReporting();
// Shown inside another site's frame, the app does not draw itself (2026-11-23): a static host cannot send
// frame-ancestors, and a framed page could be dressed up to make someone press its buttons. A link opens it on its own.
const framed = (() => { try { return window.top !== window.self; } catch { return true; } })();
if (framed) document.getElementById('root')!.innerHTML = '<p style="padding:24px;font:16px sans-serif">지금 추천은 다른 사이트 안에서 열 수 없어요. <a href="https://nowrec.kr/" target="_blank" rel="noopener">새 창에서 열기</a></p>';
else ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><ErrorBoundary><App /></ErrorBoundary></React.StrictMode>);
// The app shell works offline once visited (public/sw.js). Only on a built site: the dev server's modules must never be cached.
if (import.meta.env.PROD && 'serviceWorker' in navigator) window.addEventListener('load', () => { navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => { /* the site still works as a page */ }); });
