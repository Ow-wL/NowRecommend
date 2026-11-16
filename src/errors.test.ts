import { describe, expect, it } from 'vitest';
import { describeError, pageOf } from './errors';

describe('browser error reports', () => {
  it('name the screen, never what was in the address', () => {
    expect(pageOf('#/recommend/food/results')).toBe('recommend');
    expect(pageOf('#/reset/eyJzdWIiOiJ1MSJ9.signature')).toBe('reset');
    expect(pageOf('')).toBe('home');
    expect(pageOf('#/<script>')).toBe('home');
  });
  it('carry the message and the place in the code, cut to size', () => {
    const error = new Error('x'.repeat(500));
    error.stack = `Error: boom\n${'    at App (App.tsx:10)\n'.repeat(200)}`;
    const report = describeError('render', error, '#/home', 'abc1234')!;
    expect(report).toMatchObject({ kind: 'render', page: 'home', release: 'abc1234' });
    expect(report.message).toHaveLength(300);
    expect(report.stack.length).toBeLessThanOrEqual(2000);
    expect(describeError('promise', 'plain text reason', '#/taste')).toMatchObject({ message: 'plain text reason', stack: '', page: 'taste' });
  });
  it('leave out what is not the app’s: extensions, the browser’s own layout notice, errors with nothing to say', () => {
    const fromExtension = new Error('boom'); fromExtension.stack = 'Error: boom\n at chrome-extension://abcdef/content.js:1:1';
    expect(describeError('error', fromExtension, '#/home')).toBeNull();
    expect(describeError('error', 'ResizeObserver loop completed with undelivered notifications.', '#/home')).toBeNull();
    expect(describeError('error', 'Script error.', '#/home')).toBeNull();
    expect(describeError('promise', undefined, '#/home')).toBeNull();
  });
});
