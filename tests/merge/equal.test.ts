import { equal } from '@/merge/equal';

describe('equal()', () => {
  it('compares plain values', () => {
    expect(equal(1, 1)).toBe(true);
    expect(equal('a', 'a')).toBe(true);
    expect(equal(null, null)).toBe(true);
    expect(equal(1, 2)).toBe(false);
    expect(equal('1', 1)).toBe(false);
    expect(equal(null, undefined)).toBe(false);
  });

  it('compares arrays by length and order', () => {
    expect(equal([1, 2], [1, 2])).toBe(true);
    expect(equal([1, 2], [2, 1])).toBe(false);
    expect(equal([1], [1, 2])).toBe(false);
    expect(equal([1], { 0: 1 })).toBe(false);
    expect(equal([1], 1)).toBe(false);
  });

  it('compares objects by their keys, whatever the order of the keys', () => {
    expect(equal({ a: 1, b: [2] }, { b: [2], a: 1 })).toBe(true);
    expect(equal({ a: 1 }, { a: 2 })).toBe(false);
    expect(equal({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(equal({ a: undefined }, { b: undefined })).toBe(false);
    expect(equal({ a: 1 }, null)).toBe(false);
    expect(equal({ a: 1 }, [1])).toBe(false);
  });
});
