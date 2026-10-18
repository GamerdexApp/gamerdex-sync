export const META_FORMAT = 1;

export interface DeviceRecord {
  name: string;
  /** ISO time of the last sync of the device. */
  lastSeenAt: string;
}

/**
 * The bookkeeping file beside the saved data. It holds no game data and no token. A revision only
 * counts up, so a device with a wrong clock cannot make old data look new.
 */
export interface SyncMeta {
  format: typeof META_FORMAT;
  appId: string;
  /** One counter for each chief id. A chief that was removed keeps its counter. */
  revisions: Record<string, number>;
  settingsRevision: number;
  /** Chief ids removed on purpose, with the revision of the removal. */
  removed: Record<string, number>;
  devices: Record<string, DeviceRecord>;
  lastSyncAt: string | null;
}

export type ParsedMeta = { ok: true; meta: SyncMeta } | { ok: false; error: string };

export const emptyMeta = (appId: string): SyncMeta => ({
  format: META_FORMAT,
  appId,
  revisions: {},
  settingsRevision: 0,
  removed: {},
  devices: {},
  lastSyncAt: null,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isCounter = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

const isCounterMap = (value: unknown): value is Record<string, number> =>
  isRecord(value) && Object.values(value).every(isCounter);

const isDevice = (value: unknown): value is DeviceRecord =>
  isRecord(value) && typeof value.name === 'string' && typeof value.lastSeenAt === 'string';

/** Reads the meta file and checks the whole shape. Nothing is returned for a file that fails. */
export const parseMeta = (text: string, appId: string): ParsedMeta => {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, error: 'The meta file is not valid JSON.' };
  }
  if (!isRecord(value)) return { ok: false, error: 'The meta file is not an object.' };
  if (value.format !== META_FORMAT) return { ok: false, error: 'The meta format is not known.' };
  if (value.appId !== appId) return { ok: false, error: 'The meta file belongs to another app.' };
  if (!isCounterMap(value.revisions)) return { ok: false, error: 'The revisions are not valid.' };
  if (!isCounter(value.settingsRevision)) {
    return { ok: false, error: 'The settings revision is not valid.' };
  }
  if (!isCounterMap(value.removed)) return { ok: false, error: 'The removed list is not valid.' };
  if (!isRecord(value.devices) || !Object.values(value.devices).every(isDevice)) {
    return { ok: false, error: 'The devices are not valid.' };
  }
  if (value.lastSyncAt !== null && typeof value.lastSyncAt !== 'string') {
    return { ok: false, error: 'The last sync time is not valid.' };
  }
  return { ok: true, meta: value as unknown as SyncMeta };
};

/** Counts one change of a chief. A chief that returns after a removal leaves the removed list. */
export const withChiefRevision = (meta: SyncMeta, chiefId: string): SyncMeta => {
  return {
    ...meta,
    revisions: { ...meta.revisions, [chiefId]: (meta.revisions[chiefId] ?? 0) + 1 },
    removed: Object.fromEntries(Object.entries(meta.removed).filter(([id]) => id !== chiefId)),
  };
};

/** Counts the removal of a chief. The counter keeps rising so an old copy cannot return it. */
export const withChiefRemoved = (meta: SyncMeta, chiefId: string): SyncMeta => {
  const revision = (meta.revisions[chiefId] ?? 0) + 1;
  return {
    ...meta,
    revisions: { ...meta.revisions, [chiefId]: revision },
    removed: { ...meta.removed, [chiefId]: revision },
  };
};

export const withSettingsRevision = (meta: SyncMeta): SyncMeta => ({
  ...meta,
  settingsRevision: meta.settingsRevision + 1,
});

export const withDevice = (meta: SyncMeta, deviceId: string, device: DeviceRecord): SyncMeta => ({
  ...meta,
  devices: { ...meta.devices, [deviceId]: device },
  lastSyncAt: device.lastSeenAt,
});
