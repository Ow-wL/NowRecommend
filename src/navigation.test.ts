import { expect, it } from 'vitest';
import { defaultView, navigationDirection, parseRoute, resetTokenIn, routeFor, viewReducer, type View } from './navigation';
it('keeps routing free of raw text and uses GitHub Pages compatible hashes', () => {
  const view = viewReducer(defaultView, { page: 'recommend', category: 'music', step: 'results' });
  expect(parseRoute(routeFor(view))).toEqual(view);
  expect(parseRoute('#/history').page).toBe('history');
  expect(parseRoute('#/recommend/food').step).toBe('input');
  expect(parseRoute('#/arbitrary')).toEqual(defaultView);
});
it('reads a move deeper or to the right as forward, and back up or to the left as back', () => {
  const v = (patch: Partial<View>): View => ({ ...defaultView, ...patch });
  expect(navigationDirection(v({}), v({ page: 'recommend' }))).toBe('forward');
  expect(navigationDirection(v({ page: 'recommend' }), v({ page: 'recommend', step: 'results' }))).toBe('forward');
  expect(navigationDirection(v({ page: 'recommend', step: 'results' }), v({ page: 'recommend' }))).toBe('back');
  expect(navigationDirection(v({ page: 'recommend', step: 'results' }), v({ page: 'complete' }))).toBe('forward');
  expect(navigationDirection(v({ page: 'complete' }), v({}))).toBe('back');
  expect(navigationDirection(v({ page: 'recommend' }), v({ page: 'onboard' }))).toBe('forward');
  expect(navigationDirection(v({ page: 'favorites' }), v({ page: 'taste' }))).toBe('forward');
  expect(navigationDirection(v({ page: 'taste' }), v({ page: 'favorites' }))).toBe('back');
  expect(navigationDirection(v({ page: 'recommend' }), v({ page: 'recommend', category: 'music' }))).toBe('forward');
  expect(navigationDirection(v({ page: 'taste' }), v({}))).toBe('back');
});

// 2026-11-17: the password reset link mailed by the server (#/reset/<token>).
const resetToken = 'eyJzdWIiOiJ1MSJ9.c2lnbmF0dXJlLXNpZ25hdHVyZQ';
it('a reset link opens the login page and gives its token once', () => {
  expect(parseRoute(`#/reset/${resetToken}`).page).toBe('login');
  expect(resetTokenIn(`#/reset/${resetToken}`)).toBe(resetToken);
});
it('no token is read from other addresses or from a malformed link', () => {
  expect(resetTokenIn('#/login')).toBe('');
  expect(resetTokenIn('#/reset/short')).toBe('');
  expect(resetTokenIn(`#/reset/${resetToken}?x=<script>`)).toBe('');
  expect(resetTokenIn(`#/reset/${resetToken}/more`)).toBe('');
});
it('the terms and the privacy policy have addresses of their own', () => {
  expect(parseRoute('#/terms').page).toBe('terms');
  expect(parseRoute('#/privacy').page).toBe('privacy');
  expect(routeFor({ ...defaultView, page: 'privacy' })).toBe('#/privacy');
});
