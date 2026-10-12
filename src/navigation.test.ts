import { expect, it } from 'vitest';
import { defaultView, parseRoute, routeFor, viewReducer } from './navigation';
it('keeps routing free of raw text and uses GitHub Pages compatible hashes', () => {
  const view = viewReducer(defaultView, { page: 'recommend', category: 'music', step: 'results' });
  expect(parseRoute(routeFor(view))).toEqual(view);
  expect(parseRoute('#/history').page).toBe('history');
  expect(parseRoute('#/recommend/food').step).toBe('input');
  expect(parseRoute('#/arbitrary')).toEqual(defaultView);
});
