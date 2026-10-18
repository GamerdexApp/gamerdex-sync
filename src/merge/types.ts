/**
 * A step of a path into the saved data. A key of an object, or the id of an entry of a keyed list.
 */
export type PathStep = string;
export type Path = PathStep[];

/**
 * Says how a part of the saved data merges. The app writes one schema for its saved data.
 *
 * - `record`: a value that cannot merge. If one side changed it, that side wins. If both changed it,
 *   it is a conflict.
 * - `max`: a level. When both sides changed it, the higher one by `order` wins.
 * - `join`: a list of plain values. The result holds what both lists hold and what either side
 *   added, and drops what either side removed since the last sync.
 * - `local`: a value of this device. The merge keeps the local value and ignores the other side.
 * - `object`: a map of entries. Each entry merges with its own schema. `fields` names the entries
 *   that differ, `each` covers the others, and an entry with no schema is a `record`. With
 *   `deleteWins`, a removed entry wins over a change of the other side inside this map.
 * - `keyed`: a list of objects that each have a string `key`, such as a list of chiefs with an id.
 *   Its entries merge like the entries of an `object`.
 */
export type Schema =
  | { type: 'record' }
  | { type: 'max'; order: (value: unknown) => number }
  | { type: 'join' }
  | { type: 'local' }
  | {
      type: 'object';
      fields?: Record<string, Schema>;
      each?: Schema;
      deleteWins?: boolean;
    }
  | { type: 'keyed'; key: string; item: Schema; deleteWins?: boolean };

export type Side = 'local' | 'remote';

export type ConflictKind = 'both-changed' | 'delete-edit';

/**
 * A change that the merge could not settle by itself. The merged data already holds the value of
 * `taken`, so nothing is lost. The player can pick the other side with `resolveConflict`.
 */
export interface Conflict {
  path: Path;
  kind: ConflictKind;
  base: unknown;
  local: unknown;
  remote: unknown;
  taken: Side;
}

export interface MergeInput {
  /** The data at the last sync. Undefined when this device never synced. */
  base: unknown;
  local: unknown;
  remote: unknown;
  schema: Schema;
  /** The side that wins a conflict until the player picks. The default is the remote side. */
  prefer?: Side;
}

export interface MergeResult {
  /** The data for this device. It keeps the values of this device. */
  merged: unknown;
  /**
   * The data for the cloud. It is `merged`, except that a part with the `local` strategy keeps the
   * value of the cloud, so a value of one device never changes the cloud by itself.
   */
  cloud: unknown;
  conflicts: Conflict[];
}
