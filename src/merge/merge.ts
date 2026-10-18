import { restoreCloudValues } from './cloud';
import { equal, isObject } from './equal';
import { Conflict, MergeInput, MergeResult, Path, Schema, Side } from './types';

interface Context {
  prefer: Side;
  conflicts: Conflict[];
}

/** Reads an own key only, so an id such as `constructor` never reads from the prototype. */
const own = <T>(map: Record<string, T> | undefined, key: string): T | undefined =>
  map !== undefined && Object.hasOwn(map, key) ? map[key] : undefined;

const record = (
  base: unknown,
  local: unknown,
  remote: unknown,
  path: Path,
  context: Context,
): unknown => {
  context.conflicts.push({
    path,
    kind: 'both-changed',
    base,
    local,
    remote,
    taken: context.prefer,
  });
  return context.prefer === 'local' ? local : remote;
};

const joinLists = (base: unknown[], local: unknown[], remote: unknown[]): unknown[] => {
  const has = (list: unknown[], value: unknown) => list.some((item) => equal(item, value));
  const kept = (value: unknown) => {
    const inBase = has(base, value);
    const inLocal = has(local, value);
    const inRemote = has(remote, value);
    return inBase ? inLocal && inRemote : inLocal || inRemote;
  };
  const result: unknown[] = [];
  for (const value of [...local, ...remote]) {
    if (kept(value) && !has(result, value)) result.push(value);
  }
  return result;
};

const entriesOf = (list: unknown[], key: string): Map<string, unknown> | null => {
  const entries = new Map<string, unknown>();
  for (const item of list) {
    if (!isObject(item) || typeof item[key] !== 'string') return null;
    entries.set(item[key], item);
  }
  return entries;
};

const mergeEntries = (
  ids: string[],
  pick: (id: string) => [unknown, unknown, unknown],
  schemaOf: (id: string) => Schema,
  path: Path,
  context: Context,
  deleteWins: boolean,
): Map<string, unknown> => {
  const merged = new Map<string, unknown>();
  for (const id of ids) {
    const [base, local, remote] = pick(id);
    const value = mergeNode(base, local, remote, schemaOf(id), [...path, id], context, deleteWins);
    if (value !== undefined) merged.set(id, value);
  }
  return merged;
};

const orderedIds = (local: Iterable<string>, remote: Iterable<string>, base: Iterable<string>) => [
  ...new Set([...local, ...remote, ...base]),
];

const mergeNode = (
  base: unknown,
  local: unknown,
  remote: unknown,
  schema: Schema,
  path: Path,
  context: Context,
  deleteWins: boolean,
): unknown => {
  if (schema.type === 'local') return local;
  if (equal(local, remote)) return local;
  if (equal(local, base)) return remote;
  if (equal(remote, base)) return local;

  if (local === undefined || remote === undefined) {
    if (deleteWins) return undefined;
    const taken: Side = local === undefined ? 'remote' : 'local';
    context.conflicts.push({ path, kind: 'delete-edit', base, local, remote, taken });
    return taken === 'local' ? local : remote;
  }

  switch (schema.type) {
    case 'max': {
      const l = schema.order(local);
      const r = schema.order(remote);
      if (l === r) return record(base, local, remote, path, context);
      return l > r ? local : remote;
    }
    case 'join':
      if (Array.isArray(local) && Array.isArray(remote)) {
        return joinLists(Array.isArray(base) ? base : [], local, remote);
      }
      return record(base, local, remote, path, context);
    case 'object': {
      if (!isObject(local) || !isObject(remote)) return record(base, local, remote, path, context);
      const baseObject = isObject(base) ? base : {};
      const ids = orderedIds(Object.keys(local), Object.keys(remote), Object.keys(baseObject));
      const merged = mergeEntries(
        ids,
        (id) => [own(baseObject, id), own(local, id), own(remote, id)],
        (id) => own(schema.fields, id) ?? schema.each ?? { type: 'record' },
        path,
        context,
        deleteWins || schema.deleteWins === true,
      );
      return Object.fromEntries(merged);
    }
    case 'keyed': {
      const localEntries = Array.isArray(local) ? entriesOf(local, schema.key) : null;
      const remoteEntries = Array.isArray(remote) ? entriesOf(remote, schema.key) : null;
      const baseEntries = (Array.isArray(base) ? entriesOf(base, schema.key) : null) ?? new Map();
      if (!localEntries || !remoteEntries) return record(base, local, remote, path, context);
      const ids = orderedIds(localEntries.keys(), remoteEntries.keys(), baseEntries.keys());
      const merged = mergeEntries(
        ids,
        (id) => [baseEntries.get(id), localEntries.get(id), remoteEntries.get(id)],
        () => schema.item,
        path,
        context,
        deleteWins || schema.deleteWins === true,
      );
      return [...merged.values()];
    }
    case 'record':
      return record(base, local, remote, path, context);
  }
};

/**
 * Merges the data of this device and the data of the cloud against the data of the last sync.
 * A part that only one side changed takes that change. A part that both sides changed merges by its
 * schema, and a part that cannot merge is reported in `conflicts` with the preferred side already
 * in `merged`.
 */
export const merge = ({
  base,
  local,
  remote,
  schema,
  prefer = 'remote',
}: MergeInput): MergeResult => {
  const context: Context = { prefer, conflicts: [] };
  const merged = mergeNode(base, local, remote, schema, [], context, false);
  return {
    merged,
    cloud: restoreCloudValues(merged, remote, schema),
    conflicts: context.conflicts,
  };
};
