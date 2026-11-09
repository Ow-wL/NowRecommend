import { expect, it } from 'vitest';
import { defaultView, navigationDirection, parseRoute, routeFor, viewReducer, type View } from './navigation';
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
