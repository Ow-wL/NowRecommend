import { describe, expect, it, vi } from 'vitest';
import { installPolyfills, uuid } from './polyfills';

const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** A browser from before these functions: its own Array and String without `at`, and nothing else new. */
function oldBrowser() {
  const arrayProto = Object.create(null), stringProto = Object.create(null);
  const scope = {
    crypto: { getRandomValues: (bytes: Uint8Array) => globalThis.crypto.getRandomValues(bytes) } as unknown as Crypto,
    structuredClone: undefined as unknown,
    AbortSignal: class { } as unknown as typeof AbortSignal, AbortController, DOMException, setTimeout,
    Array: { prototype: arrayProto } as unknown as ArrayConstructor, String: { prototype: stringProto } as unknown as StringConstructor,
  };
  return { scope, arrayProto, stringProto };
}

describe('functions an older browser lacks', () => {
  it('makes ids of the same shape as crypto.randomUUID', () => {
    const { scope } = oldBrowser();
    installPolyfills(scope);
    const ids = Array.from({ length: 200 }, () => scope.crypto.randomUUID());
    expect(ids.every(id => UUID4.test(id))).toBe(true);
    expect(new Set(ids).size).toBe(200);
    expect(uuid()).toMatch(UUID4);  // with no random source at all, still an id of the right shape
    expect(uuid(bytes => bytes.fill(0xff))).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
  });

  it('copies plain data so that the copy does not share anything with the original', () => {
    const { scope } = oldBrowser();
    installPolyfills(scope);
    const clone = scope.structuredClone as <T>(value: T) => T;
    const original = { tags: ['매운', '국물'], excluded: [] as string[], nested: { n: 1, none: null }, list: [{ id: 'a' }] };
    const copy = clone(original);
    expect(copy).toEqual(original);
    copy.tags.push('면'); copy.nested.n = 2; copy.list[0].id = 'b';
    expect(original).toEqual({ tags: ['매운', '국물'], excluded: [], nested: { n: 1, none: null }, list: [{ id: 'a' }] });
    expect(clone(undefined)).toBeUndefined();
    expect(clone(null)).toBeNull();
  });

  it('reads from the end with at() on lists and text', () => {
    const { scope, arrayProto, stringProto } = oldBrowser();
    installPolyfills(scope);
    const listAt = arrayProto.at as (this: ArrayLike<unknown>, index: number) => unknown;
    expect([0, -1, -3, 3, -4, 1.9].map(index => listAt.call(['a', 'b', 'c'], index))).toEqual(['a', 'c', 'a', undefined, undefined, 'b']);
    expect((stringProto.at as typeof listAt).call('가나다', -1)).toBe('다');
    expect(listAt.call([], 0)).toBeUndefined();
  });

  it('gives a signal that aborts itself after the time given', () => {
    vi.useFakeTimers();
    try {
      const { scope } = oldBrowser();
      installPolyfills(scope);
      const signal = scope.AbortSignal.timeout(6000);
      expect(signal.aborted).toBe(false);
      vi.advanceTimersByTime(5999);
      expect(signal.aborted).toBe(false);
      vi.advanceTimersByTime(1);
      expect(signal.aborted).toBe(true);
      expect((signal.reason as DOMException).name).toBe('TimeoutError');
    } finally { vi.useRealTimers(); }
  });

  it('leaves a browser that has them as it is', () => {
    const before = [crypto.randomUUID, structuredClone, Array.prototype.at, String.prototype.at, AbortSignal.timeout];
    installPolyfills();
    expect([crypto.randomUUID, structuredClone, Array.prototype.at, String.prototype.at, AbortSignal.timeout]).toEqual(before);
  });
});
