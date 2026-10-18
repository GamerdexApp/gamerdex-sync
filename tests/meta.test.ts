import {
  emptyMeta,
  parseMeta,
  withChiefRemoved,
  withChiefRevision,
  withDevice,
  withSettingsRevision,
} from '@/meta';

const APP = 'whiteout-survival';

describe('emptyMeta()', () => {
  it('starts with no revisions, no removals and no devices', () => {
    expect(emptyMeta(APP)).toEqual({
      format: 1,
      appId: APP,
      revisions: {},
      settingsRevision: 0,
      removed: {},
      devices: {},
      lastSyncAt: null,
    });
  });
});

describe('parseMeta()', () => {
  const good = () => ({
    ...emptyMeta(APP),
    revisions: { a1: 3 },
    removed: { b2: 5 },
    devices: { d1: { name: 'Phone', lastSeenAt: '2026-10-17T10:00:00.000Z' } },
    lastSyncAt: '2026-10-17T10:00:00.000Z',
  });
  const parse = (value: unknown) => parseMeta(JSON.stringify(value), APP);

  it('reads a valid file back', () => {
    expect(parse(good())).toEqual({ ok: true, meta: good() });
    expect(parse(emptyMeta(APP))).toEqual({ ok: true, meta: emptyMeta(APP) });
  });

  it('rejects text that is not JSON and values that are not objects', () => {
    expect(parseMeta('{', APP)).toEqual({ ok: false, error: 'The meta file is not valid JSON.' });
    expect(parse([])).toEqual({ ok: false, error: 'The meta file is not an object.' });
    expect(parse(null)).toEqual({ ok: false, error: 'The meta file is not an object.' });
  });

  it('rejects an unknown format and a file of another app', () => {
    expect(parse({ ...good(), format: 2 })).toEqual({
      ok: false,
      error: 'The meta format is not known.',
    });
    expect(parse({ ...good(), appId: 'other' })).toEqual({
      ok: false,
      error: 'The meta file belongs to another app.',
    });
  });

  it('rejects counters that are not whole numbers of 0 or more', () => {
    expect(parse({ ...good(), revisions: { a1: -1 } }).ok).toBe(false);
    expect(parse({ ...good(), revisions: { a1: 1.5 } }).ok).toBe(false);
    expect(parse({ ...good(), revisions: [] }).ok).toBe(false);
    expect(parse({ ...good(), settingsRevision: -1 })).toEqual({
      ok: false,
      error: 'The settings revision is not valid.',
    });
    expect(parse({ ...good(), removed: { b2: 'x' } })).toEqual({
      ok: false,
      error: 'The removed list is not valid.',
    });
  });

  it('rejects devices and a sync time of the wrong shape', () => {
    expect(parse({ ...good(), devices: [] })).toEqual({
      ok: false,
      error: 'The devices are not valid.',
    });
    expect(parse({ ...good(), devices: { d1: { name: 1, lastSeenAt: 'x' } } }).ok).toBe(false);
    expect(parse({ ...good(), devices: { d1: null } }).ok).toBe(false);
    expect(parse({ ...good(), lastSyncAt: 5 })).toEqual({
      ok: false,
      error: 'The last sync time is not valid.',
    });
  });
});

describe('revisions', () => {
  it('counts each change of a chief and never goes back', () => {
    const first = withChiefRevision(emptyMeta(APP), 'a1');
    const second = withChiefRevision(first, 'a1');
    expect(first.revisions).toEqual({ a1: 1 });
    expect(second.revisions).toEqual({ a1: 2 });
    expect(withChiefRevision(second, 'b2').revisions).toEqual({ a1: 2, b2: 1 });
  });

  it('keeps the counter of a removed chief and lists the removal', () => {
    const removed = withChiefRemoved(withChiefRevision(emptyMeta(APP), 'a1'), 'a1');
    expect(removed.revisions).toEqual({ a1: 2 });
    expect(removed.removed).toEqual({ a1: 2 });
    expect(withChiefRemoved(emptyMeta(APP), 'c3').removed).toEqual({ c3: 1 });
  });

  it('takes a chief off the removed list when it changes again', () => {
    const removed = withChiefRemoved(emptyMeta(APP), 'a1');
    const back = withChiefRevision(removed, 'a1');
    expect(back.removed).toEqual({});
    expect(back.revisions).toEqual({ a1: 2 });
  });

  it('counts the settings on their own', () => {
    expect(withSettingsRevision(withSettingsRevision(emptyMeta(APP))).settingsRevision).toBe(2);
  });
});

describe('withDevice()', () => {
  it('records the device and the last sync time', () => {
    const seen = { name: 'Laptop', lastSeenAt: '2026-10-17T12:00:00.000Z' };
    const meta = withDevice(emptyMeta(APP), 'd9', seen);
    expect(meta.devices).toEqual({ d9: seen });
    expect(meta.lastSyncAt).toBe(seen.lastSeenAt);
  });
});
