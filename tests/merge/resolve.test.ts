import { merge } from '@/merge/merge';
import { resolveConflict } from '@/merge/resolve';
import { Conflict, Schema } from '@/merge/types';

const record: Schema = { type: 'record' };

const app: Schema = {
  type: 'object',
  fields: {
    playthroughs: {
      type: 'keyed',
      key: 'id',
      item: { type: 'object', fields: { name: record }, each: { type: 'object' } },
    },
    settings: { type: 'object', each: record },
    notes: record,
  },
};

const conflictOf = (path: string[], local: unknown, remote: unknown): Conflict => ({
  path,
  kind: 'both-changed',
  base: undefined,
  local,
  remote,
  taken: 'remote',
});

describe('resolveConflict()', () => {
  it('puts the local value into a field of an object', () => {
    const merged = { notes: 'theirs', settings: { theme: 'dark' } };
    const result = resolveConflict(
      merged,
      app,
      conflictOf(['settings', 'theme'], 'light', 'dark'),
      'local',
    );
    expect(result).toEqual({ notes: 'theirs', settings: { theme: 'light' } });
  });

  it('puts the remote value back when the player picks the cloud', () => {
    const result = resolveConflict(
      { notes: 'mine' },
      app,
      conflictOf(['notes'], 'mine', 'theirs'),
      'remote',
    );
    expect(result).toEqual({ notes: 'theirs' });
  });

  it('reaches into an entry of a keyed list by its id', () => {
    const merged = {
      playthroughs: [
        { id: 'a', name: 'Theirs' },
        { id: 'b', name: 'B' },
      ],
    };
    const result = resolveConflict(
      merged,
      app,
      conflictOf(['playthroughs', 'a', 'name'], 'Mine', 'Theirs'),
      'local',
    );
    expect(result).toEqual({
      playthroughs: [
        { id: 'a', name: 'Mine' },
        { id: 'b', name: 'B' },
      ],
    });
  });

  it('removes an entry when the side that the player picks holds no value', () => {
    const merged = {
      playthroughs: [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ],
    };
    const conflict: Conflict = {
      ...conflictOf(['playthroughs', 'b'], undefined, { id: 'b' }),
      kind: 'delete-edit',
    };
    expect(resolveConflict(merged, app, conflict, 'local')).toEqual({
      playthroughs: [{ id: 'a', name: 'A' }],
    });
  });

  it('removes a field of an object when the picked side holds no value', () => {
    const merged = { settings: { theme: 'dark', zoom: 2 } };
    const conflict = conflictOf(['settings', 'zoom'], undefined, 2);
    expect(resolveConflict(merged, app, conflict, 'local')).toEqual({
      settings: { theme: 'dark' },
    });
  });

  it('adds an entry of a keyed list that the merge left out', () => {
    const merged = { playthroughs: [{ id: 'a', name: 'A' }] };
    const conflict = conflictOf(['playthroughs', 'b'], { id: 'b', name: 'B' }, undefined);
    expect(resolveConflict(merged, app, conflict, 'local')).toEqual({
      playthroughs: [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ],
    });
  });

  it('leaves a keyed list alone when an entry to remove is not in it', () => {
    const merged = { playthroughs: [{ id: 'a', name: 'A' }] };
    const conflict = conflictOf(['playthroughs', 'zz'], undefined, { id: 'zz' });
    expect(resolveConflict(merged, app, conflict, 'local')).toEqual(merged);
  });

  it('builds the objects and lists on the way when the merged data has none', () => {
    const conflict = conflictOf(['playthroughs', 'a', 'name'], 'Mine', 'Theirs');
    expect(resolveConflict({}, app, conflict, 'local')).toEqual({
      playthroughs: [{ name: 'Mine' }],
    });
    expect(resolveConflict(undefined, app, conflictOf(['notes'], 'x', 'y'), 'local')).toEqual({
      notes: 'x',
    });
  });

  it('uses the schema of each entry, and a record for a name the schema does not know', () => {
    const merged = { playthroughs: [{ id: 'a', name: 'A', extra: { v: 1 } }] };
    const result = resolveConflict(
      merged,
      app,
      conflictOf(['playthroughs', 'a', 'extra', 'v'], 2, 1),
      'local',
    );
    expect(result).toEqual({ playthroughs: [{ id: 'a', name: 'A', extra: { v: 2 } }] });
    const loose = resolveConflict(
      { x: 1 },
      { type: 'record' },
      conflictOf(['x', 'y'], 2, 1),
      'local',
    );
    expect(loose).toEqual({ x: { y: 2 } });
  });

  it('settles every conflict of a merge by the side that the player picks', () => {
    const base = { settings: { theme: 'light' }, notes: 'a' };
    const result = merge({
      base,
      local: { settings: { theme: 'sepia' }, notes: 'b' },
      remote: { settings: { theme: 'dark' }, notes: 'c' },
      schema: app,
    });
    expect(result.merged).toEqual({ settings: { theme: 'dark' }, notes: 'c' });
    const picked = result.conflicts.reduce(
      (data, conflict) => resolveConflict(data, app, conflict, 'local'),
      result.merged,
    );
    expect(picked).toEqual({ settings: { theme: 'sepia' }, notes: 'b' });
  });
});
