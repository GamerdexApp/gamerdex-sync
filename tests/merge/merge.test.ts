import { merge } from '@/merge/merge';
import { Schema } from '@/merge/types';

const record: Schema = { type: 'record' };
const level: Schema = { type: 'max', order: (value) => Number(value) };

describe('merge(): one side changed', () => {
  it('returns the data when nothing changed', () => {
    expect(
      merge({ base: { a: 1 }, local: { a: 1 }, remote: { a: 1 }, schema: record }),
    ).toMatchObject({
      merged: { a: 1 },
      conflicts: [],
    });
  });

  it('takes the change of the local side', () => {
    const result = merge({ base: { a: 1 }, local: { a: 2 }, remote: { a: 1 }, schema: record });
    expect(result).toMatchObject({ merged: { a: 2 }, conflicts: [] });
  });

  it('takes the change of the remote side', () => {
    const result = merge({ base: { a: 1 }, local: { a: 1 }, remote: { a: 3 }, schema: record });
    expect(result).toMatchObject({ merged: { a: 3 }, conflicts: [] });
  });

  it('takes a value that both sides changed to the same thing', () => {
    const result = merge({ base: 1, local: 5, remote: 5, schema: record });
    expect(result).toMatchObject({ merged: 5, conflicts: [] });
  });

  it('takes the data of the cloud when this device never synced and holds nothing', () => {
    const result = merge({ base: undefined, local: undefined, remote: { a: 1 }, schema: record });
    expect(result).toMatchObject({ merged: { a: 1 }, conflicts: [] });
  });
});

describe('merge(): record', () => {
  const input = { base: 'old', local: 'mine', remote: 'theirs', schema: record };

  it('reports a conflict and keeps the remote side by default', () => {
    expect(merge(input)).toMatchObject({
      merged: 'theirs',
      conflicts: [
        {
          path: [],
          kind: 'both-changed',
          base: 'old',
          local: 'mine',
          remote: 'theirs',
          taken: 'remote',
        },
      ],
    });
  });

  it('keeps the local side when it is preferred', () => {
    const result = merge({ ...input, prefer: 'local' });
    expect(result.merged).toBe('mine');
    expect(result.conflicts[0].taken).toBe('local');
  });

  it('is the schema of an entry that has none', () => {
    const result = merge({
      base: { a: 1 },
      local: { a: 2 },
      remote: { a: 3 },
      schema: { type: 'object' },
    });
    expect(result.merged).toEqual({ a: 3 });
    expect(result.conflicts.map((conflict) => conflict.path)).toEqual([['a']]);
  });
});

describe('merge(): max', () => {
  const schema: Schema = { type: 'object', each: level };

  it('takes the higher level when both sides changed it', () => {
    expect(merge({ base: { a: 1 }, local: { a: 4 }, remote: { a: 3 }, schema }).merged).toEqual({
      a: 4,
    });
    expect(merge({ base: { a: 1 }, local: { a: 2 }, remote: { a: 3 }, schema }).merged).toEqual({
      a: 3,
    });
  });

  it('takes a lower level when only one side changed it', () => {
    expect(merge({ base: { a: 5 }, local: { a: 2 }, remote: { a: 5 }, schema })).toMatchObject({
      merged: { a: 2 },
      conflicts: [],
    });
  });

  it('reports a conflict when two different values rank the same', () => {
    const same: Schema = { type: 'max', order: () => 1 };
    const result = merge({ base: 'a', local: 'b', remote: 'c', schema: same });
    expect(result.merged).toBe('c');
    expect(result.conflicts).toHaveLength(1);
  });

  it('takes the higher level of an entry that both sides added', () => {
    expect(merge({ base: {}, local: { a: 2 }, remote: { a: 6 }, schema }).merged).toEqual({ a: 6 });
  });
});

describe('merge(): join', () => {
  const join: Schema = { type: 'join' };
  const run = (base: unknown, local: unknown, remote: unknown) =>
    merge({ base, local, remote, schema: join });

  it('keeps what both lists hold and what either side added', () => {
    expect(run(['a'], ['a', 'b'], ['a', 'c']).merged).toEqual(['a', 'b', 'c']);
  });

  it('drops what either side removed since the last sync', () => {
    expect(run(['a', 'b'], ['a'], ['a', 'b', 'c']).merged).toEqual(['a', 'c']);
    expect(run(['a', 'b'], ['a', 'b'], ['b']).merged).toEqual(['b']);
  });

  it('keeps a value once even when both sides added it', () => {
    expect(run(['a'], ['a', 'b'], ['a', 'b']).merged).toEqual(['a', 'b']);
    expect(run(['a'], ['a', 'b', 'c'], ['a', 'c', 'd']).merged).toEqual(['a', 'b', 'c', 'd']);
  });

  it('compares values deeply', () => {
    expect(run([{ x: 1 }], [{ x: 1 }, { x: 2 }], [{ x: 1 }, { x: 3 }]).merged).toEqual([
      { x: 1 },
      { x: 2 },
      { x: 3 },
    ]);
  });

  it('starts from an empty list when the base is not a list', () => {
    expect(run(undefined, ['a'], ['b']).merged).toEqual(['a', 'b']);
    expect(run('text', ['a'], ['b']).merged).toEqual(['a', 'b']);
  });

  it('is a conflict when a side is not a list', () => {
    const result = run(['a'], ['b'], 'oops');
    expect(result.merged).toBe('oops');
    expect(result.conflicts[0].kind).toBe('both-changed');
    expect(run(['a'], 'oops', ['b']).conflicts).toHaveLength(1);
  });
});

describe('merge(): local', () => {
  it('keeps the value of this device and ignores the cloud', () => {
    expect(
      merge({ base: 'a1', local: 'b2', remote: 'c3', schema: { type: 'local' } }),
    ).toMatchObject({
      merged: 'b2',
      conflicts: [],
    });
    expect(
      merge({ base: undefined, local: undefined, remote: 'c3', schema: { type: 'local' } }).merged,
    ).toBeUndefined();
  });
});

describe('merge(): the copy for the cloud', () => {
  const schema: Schema = {
    type: 'object',
    fields: { active: { type: 'local' }, level: { type: 'max', order: (value) => Number(value) } },
  };

  it('keeps the cloud value of a device value and merges the rest', () => {
    const result = merge({
      base: { active: 'a', level: 1 },
      local: { active: 'b', level: 3 },
      remote: { active: 'a', level: 2 },
      schema,
    });
    expect(result.merged).toEqual({ active: 'b', level: 3 });
    expect(result.cloud).toEqual({ active: 'a', level: 3 });
  });

  it('is the same as the merged data when there is no device value', () => {
    const result = merge({
      base: { a: 1 },
      local: { a: 2 },
      remote: { a: 1 },
      schema: { type: 'object' },
    });
    expect(result.cloud).toEqual(result.merged);
  });
});

describe('merge(): object', () => {
  const schema: Schema = {
    type: 'object',
    fields: { name: record, level },
    each: { type: 'join' },
  };

  it('merges each entry with the schema of its name, then of each, then as a record', () => {
    const result = merge({
      base: { name: 'x', level: 1, tags: ['a'], other: 1 },
      local: { name: 'x', level: 3, tags: ['a', 'b'], other: 2 },
      remote: { name: 'x', level: 2, tags: ['a', 'c'], other: 1 },
      schema: { ...schema, fields: { ...schema.fields, other: record } } as Schema,
    });
    expect(result.merged).toEqual({ name: 'x', level: 3, tags: ['a', 'b', 'c'], other: 2 });
    expect(result.conflicts).toEqual([]);
  });

  it('adds an entry that one side added and keeps it when the other did not touch it', () => {
    const result = merge({
      base: { a: 1 },
      local: { a: 1, b: 2 },
      remote: { a: 1, c: 3 },
      schema: { type: 'object' },
    });
    expect(result.merged).toEqual({ a: 1, b: 2, c: 3 });
    expect(result.conflicts).toEqual([]);
  });

  it('removes an entry that one side removed and the other left alone', () => {
    const result = merge({
      base: { a: 1, b: 2 },
      local: { a: 1 },
      remote: { a: 1, b: 2 },
      schema: { type: 'object' },
    });
    expect(result.merged).toEqual({ a: 1 });
  });

  it('keeps an entry that one side removed and the other changed, and reports it', () => {
    const result = merge({
      base: { a: 1, b: 2 },
      local: { a: 1 },
      remote: { a: 1, b: 9 },
      schema: { type: 'object' },
    });
    expect(result.merged).toEqual({ a: 1, b: 9 });
    expect(result.conflicts).toEqual([
      { path: ['b'], kind: 'delete-edit', base: 2, local: undefined, remote: 9, taken: 'remote' },
    ]);
    const flipped = merge({
      base: { a: 1, b: 2 },
      local: { a: 1, b: 9 },
      remote: { a: 1 },
      schema: { type: 'object' },
    });
    expect(flipped.merged).toEqual({ a: 1, b: 9 });
    expect(flipped.conflicts[0].taken).toBe('local');
  });

  it('lets a removal win in a map with deleteWins', () => {
    const result = merge({
      base: { a: 1, b: 2 },
      local: { a: 1 },
      remote: { a: 1, b: 9 },
      schema: { type: 'object', deleteWins: true },
    });
    expect(result).toMatchObject({ merged: { a: 1 }, conflicts: [] });
  });

  it('passes deleteWins down to the entries below', () => {
    const result = merge({
      base: { chief: { buildings: { x: 1 } } },
      local: { chief: { buildings: {} } },
      remote: { chief: { buildings: { x: 5 } } },
      schema: {
        type: 'object',
        each: { type: 'object', deleteWins: true, each: { type: 'object' } },
      },
    });
    expect(result.merged).toEqual({ chief: { buildings: {} } });
    expect(result.conflicts).toEqual([]);
  });

  it('puts the keys of this device first and then the keys that only the cloud has', () => {
    const result = merge({
      base: {},
      local: { b: 1, a: 1 },
      remote: { c: 1, a: 1, b: 1 },
      schema: { type: 'object' },
    });
    expect(Object.keys(result.merged as object)).toEqual(['b', 'a', 'c']);
  });

  it('treats a key such as constructor as a plain key', () => {
    const result = merge({
      base: {},
      local: { constructor: 1 },
      remote: { constructor: 2, toString: 3 },
      schema: { type: 'object', fields: { toString: record }, each: level },
    });
    expect(result.merged).toEqual({ constructor: 2, toString: 3 });
  });

  it('is a conflict when a side is not an object', () => {
    const result = merge({
      base: { a: 1 },
      local: { a: 2 },
      remote: 'oops',
      schema: { type: 'object' },
    });
    expect(result.merged).toBe('oops');
    expect(result.conflicts[0].kind).toBe('both-changed');
    expect(
      merge({ base: { a: 1 }, local: [1], remote: { a: 2 }, schema: { type: 'object' } }).conflicts,
    ).toHaveLength(1);
  });

  it('starts from an empty base when the base is not an object', () => {
    const result = merge({
      base: 5,
      local: { a: 1 },
      remote: { b: 2 },
      schema: { type: 'object' },
    });
    expect(result.merged).toEqual({ a: 1, b: 2 });
  });
});

describe('merge(): keyed', () => {
  const chief = (id: string, name: string, level = 1) => ({ id, name, level });
  const schema: Schema = {
    type: 'keyed',
    key: 'id',
    item: { type: 'object', fields: { id: record, name: record, level } },
  };
  const run = (base: unknown, local: unknown, remote: unknown, extra: Partial<Schema> = {}) =>
    merge({ base, local, remote, schema: { ...schema, ...extra } as Schema });

  it('merges the entries with the same id and keeps the order of this device', () => {
    const result = run(
      [chief('a', 'A'), chief('b', 'B')],
      [chief('b', 'B', 4), chief('a', 'A')],
      [chief('a', 'A', 2), chief('b', 'B')],
    );
    expect(result.merged).toEqual([chief('b', 'B', 4), chief('a', 'A', 2)]);
    expect(result.conflicts).toEqual([]);
  });

  it('adds the entries that either side added, the cloud ones after the local ones', () => {
    const result = run(
      [chief('a', 'A')],
      [chief('a', 'A'), chief('c', 'C')],
      [chief('a', 'A'), chief('b', 'B')],
    );
    expect(result.merged).toEqual([chief('a', 'A'), chief('c', 'C'), chief('b', 'B')]);
  });

  it('reports a conflict inside an entry with the id in the path', () => {
    const result = run([chief('a', 'A')], [chief('a', 'Mine')], [chief('a', 'Theirs')]);
    expect(result.merged).toEqual([chief('a', 'Theirs')]);
    expect(result.conflicts).toEqual([
      {
        path: ['a', 'name'],
        kind: 'both-changed',
        base: 'A',
        local: 'Mine',
        remote: 'Theirs',
        taken: 'remote',
      },
    ]);
  });

  it('keeps a removed entry that the other side changed, and reports it', () => {
    const result = run(
      [chief('a', 'A'), chief('b', 'B')],
      [chief('a', 'A')],
      [chief('a', 'A'), chief('b', 'B', 7)],
    );
    expect(result.merged).toEqual([chief('a', 'A'), chief('b', 'B', 7)]);
    expect(result.conflicts).toEqual([
      {
        path: ['b'],
        kind: 'delete-edit',
        base: chief('b', 'B'),
        local: undefined,
        remote: chief('b', 'B', 7),
        taken: 'remote',
      },
    ]);
  });

  it('removes an entry that one side removed and the other left alone', () => {
    const result = run(
      [chief('a', 'A'), chief('b', 'B')],
      [chief('a', 'A')],
      [chief('a', 'A'), chief('b', 'B')],
    );
    expect(result.merged).toEqual([chief('a', 'A')]);
  });

  it('lets a removal win with deleteWins', () => {
    const result = run([chief('a', 'A')], [], [chief('a', 'A', 3)], { deleteWins: true });
    expect(result).toMatchObject({ merged: [], conflicts: [] });
  });

  it('passes deleteWins down to the fields of the entries', () => {
    const nested: Schema = {
      type: 'keyed',
      key: 'id',
      deleteWins: true,
      item: { type: 'object', each: { type: 'object', each: level } },
    };
    const result = merge({
      base: [{ id: 'a', tags: { x: 1 } }],
      local: [{ id: 'a', tags: {} }],
      remote: [{ id: 'a', tags: { x: 5 } }],
      schema: nested,
    });
    expect(result).toMatchObject({ merged: [{ id: 'a', tags: {} }], conflicts: [] });
  });

  it('starts from an empty base when the base is not a list or not keyed', () => {
    expect(run(undefined, [chief('a', 'A')], [chief('b', 'B')]).merged).toEqual([
      chief('a', 'A'),
      chief('b', 'B'),
    ]);
    expect(run([1, 2], [chief('a', 'A')], [chief('b', 'B')]).merged).toEqual([
      chief('a', 'A'),
      chief('b', 'B'),
    ]);
  });

  it('is a conflict when a side is not a keyed list', () => {
    const notList = run([chief('a', 'A')], [chief('a', 'B')], 'oops');
    expect(notList.merged).toBe('oops');
    expect(notList.conflicts).toHaveLength(1);
    expect(run([chief('a', 'A')], 'oops', [chief('a', 'B')]).conflicts).toHaveLength(1);
    expect(run([chief('a', 'A')], [{ name: 'no id' }], [chief('a', 'B')]).conflicts).toHaveLength(
      1,
    );
    expect(run([chief('a', 'A')], [chief('a', 'B')], [5]).conflicts).toHaveLength(1);
    expect(run([chief('a', 'A')], [chief('a', 'B')], [{ id: 5 }]).conflicts).toHaveLength(1);
  });
});

describe('merge(): a whole app', () => {
  const app: Schema = {
    type: 'object',
    fields: {
      playthroughs: {
        type: 'keyed',
        key: 'id',
        item: {
          type: 'object',
          fields: { id: record, name: record },
          each: { type: 'object', each: { type: 'object', each: level } },
        },
      },
      activePlaythroughId: { type: 'local' },
      settings: record,
    },
  };

  it('merges two devices that changed different things', () => {
    const base = {
      playthroughs: [{ id: 'a', name: 'Pezz', buildings: { furnace: { level: 5 } } }],
      activePlaythroughId: 'a',
      settings: { theme: 'light' },
    };
    const local = {
      playthroughs: [{ id: 'a', name: 'Pezz', buildings: { furnace: { level: 6 } } }],
      activePlaythroughId: 'a',
      settings: { theme: 'light' },
    };
    const remote = {
      playthroughs: [
        { id: 'a', name: 'Pezz', buildings: { furnace: { level: 5 }, embassy: { level: 2 } } },
        { id: 'b', name: 'Alt' },
      ],
      activePlaythroughId: 'b',
      settings: { theme: 'dark' },
    };
    expect(merge({ base, local, remote, schema: app })).toMatchObject({
      merged: {
        playthroughs: [
          { id: 'a', name: 'Pezz', buildings: { furnace: { level: 6 }, embassy: { level: 2 } } },
          { id: 'b', name: 'Alt' },
        ],
        activePlaythroughId: 'a',
        settings: { theme: 'dark' },
      },
      conflicts: [],
    });
  });
});
