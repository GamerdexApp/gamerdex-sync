import { dataPath, metaPath } from '../layout';
import { restoreCloudValues } from '../merge/cloud';
import { equal } from '../merge/equal';
import { merge } from '../merge/merge';
import { Conflict, Schema } from '../merge/types';
import { emptyMeta, parseMeta, SyncMeta, withDevice } from '../meta';
import { SyncProvider, VersionConflictError } from '../provider/types';

const MAX_ATTEMPTS = 4;

/**
 * What this device remembers about the last sync. The app keeps it in the browser, next to the
 * saved data but outside it, and passes it back on the next sync.
 */
export interface SyncState {
  /** The cloud data as this device last saw it. */
  base: unknown;
  dataVersion: string | null;
  metaVersion: string | null;
}

/** What to do when this device never synced and both the device and the cloud hold data. */
export type FirstSyncChoice = 'merge' | 'keep-local' | 'keep-cloud';

export interface SyncOptions {
  appId: string;
  deviceId: string;
  deviceName: string;
  provider: SyncProvider;
  schema: Schema;
  /** The data of this device. */
  local: unknown;
  /** The state kept after the last sync, or null when this device never synced. */
  state: SyncState | null;
  firstSync?: FirstSyncChoice;
  /** Returns true when the data is whole and safe to store. Called before any write. */
  validate?: (data: unknown) => boolean;
  /** Lets the app change the revisions of the meta file for this sync. */
  updateMeta?: (meta: SyncMeta) => SyncMeta;
  /** The current time as an ISO text. */
  now: () => string;
}

export type SyncResult =
  | {
      status: 'synced';
      /** The data to store on this device. */
      data: unknown;
      /** The state to keep for the next sync. */
      state: SyncState;
      conflicts: Conflict[];
      /** True when the cloud changed during this sync. */
      uploaded: boolean;
    }
  | {
      /** The device and the cloud both hold data and the app has not said what to do. */
      status: 'needs-choice';
      local: unknown;
      remote: unknown;
    };

/** The data in the cloud is not whole, so nothing was written. */
export class RemoteDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RemoteDataError';
  }
}

/** Other devices kept writing during every try, so the sync stopped. Try again later. */
export class SyncBusyError extends Error {
  constructor() {
    super('The cloud kept changing during the sync.');
    this.name = 'SyncBusyError';
  }
}

const parseData = (text: string, validate: SyncOptions['validate']): unknown => {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new RemoteDataError('The synced data is not valid JSON.');
  }
  if (validate && !validate(data)) throw new RemoteDataError('The synced data is not valid.');
  return data;
};

const readMeta = (text: string | undefined, appId: string): SyncMeta => {
  if (text === undefined) return emptyMeta(appId);
  const parsed = parseMeta(text, appId);
  if (!parsed.ok) throw new RemoteDataError(parsed.error);
  return parsed.meta;
};

const writeMeta = async (options: SyncOptions): Promise<string> => {
  const { provider, appId, deviceId, deviceName, updateMeta, now } = options;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const current = await provider.read(metaPath(appId));
    const meta = readMeta(current?.content, appId);
    const time = now();
    const updated = withDevice(updateMeta ? updateMeta(meta) : meta, deviceId, {
      name: deviceName,
      lastSeenAt: time,
    });
    try {
      const written = await provider.write(
        metaPath(appId),
        JSON.stringify({ ...updated, lastSyncAt: time }, null, 2),
        current?.version ?? null,
      );
      return written.version;
    } catch (error) {
      if (!(error instanceof VersionConflictError)) throw error;
    }
  }
  throw new SyncBusyError();
};

/**
 * Brings this device and the cloud to the same data. It reads the cloud, merges the three copies,
 * writes the cloud copy when it changed, and returns the data to store on this device with the
 * state to keep. It never changes the device by itself, and it does not write when the cloud data
 * or the merged data fail `validate`.
 *
 * Throws `ProviderError` when the provider fails, `RemoteDataError` when the cloud data is not
 * whole, and `SyncBusyError` when other devices keep writing.
 */
export const sync = async (options: SyncOptions): Promise<SyncResult> => {
  const { appId, provider, schema, local, state, firstSync, validate } = options;
  const path = dataPath(appId);

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const file = await provider.read(path);

    if (file === null) {
      if (validate && !validate(local))
        throw new RemoteDataError('The data of this device is not valid.');
      const cloud = restoreCloudValues(local, undefined, schema);
      const created = await tryWrite(provider, path, cloud, null);
      if (created === null) continue;
      const metaVersion = await writeMeta(options);
      return done(local, cloud, created, metaVersion, [], true);
    }

    const remote = parseData(file.content, validate);
    const differs = state === null && !equal(restoreCloudValues(local, remote, schema), remote);
    const choice = differs ? firstSync : undefined;
    if (differs && choice === undefined) return { status: 'needs-choice', local, remote };

    const base = state === null ? undefined : state.base;
    const merged = mergeFor(choice, { base, local, remote, schema });
    if (validate && !validate(merged.merged)) {
      throw new RemoteDataError('The merged data is not valid.');
    }

    if (equal(merged.cloud, remote)) {
      const metaVersion = await writeMeta(options);
      return done(merged.merged, merged.cloud, file.version, metaVersion, merged.conflicts, false);
    }

    const version = await tryWrite(provider, path, merged.cloud, file.version);
    if (version === null) continue;
    const metaVersion = await writeMeta(options);
    return done(merged.merged, merged.cloud, version, metaVersion, merged.conflicts, true);
  }
  throw new SyncBusyError();
};

const mergeFor = (
  choice: FirstSyncChoice | undefined,
  input: { base: unknown; local: unknown; remote: unknown; schema: Schema },
) => {
  if (choice === 'keep-local') {
    const cloud = restoreCloudValues(input.local, input.remote, input.schema);
    return { merged: input.local, cloud, conflicts: [] };
  }
  if (choice === 'keep-cloud') {
    const merged = restoreCloudValues(input.remote, input.local, input.schema);
    return { merged, cloud: input.remote, conflicts: [] };
  }
  return merge(input);
};

const tryWrite = async (
  provider: SyncProvider,
  path: string,
  data: unknown,
  version: string | null,
): Promise<string | null> => {
  try {
    return (await provider.write(path, JSON.stringify(data, null, 2), version)).version;
  } catch (error) {
    if (error instanceof VersionConflictError) return null;
    throw error;
  }
};

const done = (
  data: unknown,
  cloud: unknown,
  dataVersion: string,
  metaVersion: string,
  conflicts: Conflict[],
  uploaded: boolean,
): SyncResult => ({
  status: 'synced',
  data,
  state: { base: cloud, dataVersion, metaVersion },
  conflicts,
  uploaded,
});
