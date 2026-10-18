import { equal } from '@/merge/equal';
import { merge } from '@/merge/merge';
import { resolveConflict } from '@/merge/resolve';
import { Schema } from '@/merge/types';

const schema: Schema = {
  type: 'object',
  each: {
    type: 'object',
    fields: {
      level: { type: 'max', order: (value) => Number(value) },
      tags: { type: 'join' },
      name: { type: 'record' },
    },
  },
};

/** A small deterministic random source, so a failing case can be run again. */
const randomSource = (seed: number) => {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
};

type Random = () => number;
const pick = <T>(random: Random, values: T[]): T => values[Math.floor(random() * values.length)];

const entry = (random: Random) => {
  const result: Record<string, unknown> = {};
  if (random() < 0.8) result.level = Math.floor(random() * 6);
  if (random() < 0.8) {
    result.tags = ['x', 'y', 'z'].filter(() => random() < 0.5);
  }
  if (random() < 0.8) result.name = pick(random, ['A', 'B', 'C']);
  return result;
};

const data = (random: Random) =>
  Object.fromEntries(
    ['a', 'b', 'c'].filter(() => random() < 0.7).map((key) => [key, entry(random)]),
  );

/** Changes some parts of a copy of the data, the way a device changes its saved data. */
const edit = (random: Random, base: Record<string, unknown>) => {
  const copy = JSON.parse(JSON.stringify(base)) as Record<string, Record<string, unknown>>;
  for (const key of ['a', 'b', 'c']) {
    const chance = random();
    if (chance < 0.2) delete copy[key];
    else if (chance < 0.5) copy[key] = entry(random);
  }
  return copy;
};

/** Makes lists compare by content, because the order of a joined list is not part of the result. */
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical).sort();
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, canonical(item)]));
  }
  return value;
};

describe('merge() properties', () => {
  const cases = Array.from({ length: 3000 }, (_, index) => {
    const random = randomSource(index + 1);
    const base = data(random);
    return { base, local: edit(random, base), remote: edit(random, base) };
  });

  it('returns the same data when both sides are the same', () => {
    for (const { base, local } of cases) {
      const result = merge({ base, local, remote: local, schema });
      expect(equal(result.merged, local)).toBe(true);
      expect(result.conflicts).toEqual([]);
    }
  });

  it('takes the change of a side when the other side did not change', () => {
    for (const { base, local } of cases) {
      expect(equal(merge({ base, local, remote: base, schema }).merged, local)).toBe(true);
      expect(equal(merge({ base, local: base, remote: local, schema }).merged, local)).toBe(true);
    }
  });

  it('gives the same result when the two devices swap places', () => {
    for (const { base, local, remote } of cases) {
      const one = merge({ base, local, remote, schema, prefer: 'remote' });
      const two = merge({ base, local: remote, remote: local, schema, prefer: 'local' });
      expect(canonical(one.merged)).toEqual(canonical(two.merged));
      expect(one.conflicts.length).toBe(two.conflicts.length);
    }
  });

  it('is stable when the merged data is merged again', () => {
    for (const { base, local, remote } of cases) {
      const { merged } = merge({ base, local, remote, schema });
      const again = merge({ base: merged, local: merged, remote: merged, schema });
      expect(equal(again.merged, merged)).toBe(true);
    }
  });

  it('never invents an entry that no side holds', () => {
    for (const { base, local, remote } of cases) {
      const { merged } = merge({ base, local, remote, schema });
      const known = new Set([...Object.keys(local), ...Object.keys(remote)]);
      for (const key of Object.keys(merged as object)) expect(known.has(key)).toBe(true);
    }
  });

  it('lets the player pick the local side of every conflict of two changed values', () => {
    for (const { base, local, remote } of cases) {
      const preferRemote = merge({ base, local, remote, schema, prefer: 'remote' });
      const changedBoth = preferRemote.conflicts.filter(
        (conflict) => conflict.kind === 'both-changed',
      );
      const picked = changedBoth.reduce(
        (merged, conflict) => resolveConflict(merged, schema, conflict, 'local'),
        preferRemote.merged,
      );
      const preferLocal = merge({ base, local, remote, schema, prefer: 'local' });
      expect(canonical(picked)).toEqual(canonical(preferLocal.merged));
    }
  });
});

describe('merge() delete and edit', () => {
  it('keeps the edited side whichever side is preferred, so nothing is removed unasked', () => {
    for (const prefer of ['local', 'remote'] as const) {
      const result = merge({
        base: { a: { level: 1 } },
        local: {},
        remote: { a: { level: 2 } },
        schema,
        prefer,
      });
      expect(result.merged).toEqual({ a: { level: 2 } });
      expect(result.conflicts[0].kind).toBe('delete-edit');
    }
  });
});
