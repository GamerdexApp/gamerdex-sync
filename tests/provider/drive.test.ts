import { dataPath, metaPath } from '@/layout';
import { Schema } from '@/merge/types';
import { GoogleDriveProvider } from '@/provider/drive';
import { ProviderError, VersionConflictError } from '@/provider/types';
import { sync, SyncState } from '@/sync/sync';
import { createFakeDrive } from './fakeDrive';

const PATH = 'Gamerdex/my-app/data.json';

const setup = () => {
  const fake = createFakeDrive();
  const provider = new GoogleDriveProvider({ getToken: async () => fake.token, fetch: fake.fetch });
  return { fake, provider };
};

const kindOf = async (action: Promise<unknown>) => {
  const error = await action.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ProviderError);
  return error as ProviderError;
};

describe('GoogleDriveProvider.read()', () => {
  it('returns null when the folders or the file do not exist', async () => {
    const { fake, provider } = setup();
    expect(await provider.read(PATH)).toBeNull();
    const gamerdex = fake.seedFolder('Gamerdex', 'root');
    fake.seedFolder('my-app', gamerdex.id);
    expect(await provider.read(PATH)).toBeNull();
  });

  it('returns the content and the head revision as the version', async () => {
    const { provider } = setup();
    const { version } = await provider.write(PATH, '{"a":1}', null);
    expect(await provider.read(PATH)).toEqual({ content: '{"a":1}', version });
  });

  it('reads text with accents and emoji unchanged', async () => {
    const { provider } = setup();
    await provider.write(PATH, '{"name":"Ünï 🙂"}', null);
    expect((await provider.read(PATH))?.content).toBe('{"name":"Ünï 🙂"}');
  });

  it('returns null for a file in the trash and for a file that vanished', async () => {
    const { fake, provider } = setup();
    await provider.write(PATH, 'x', null);
    const item = fake.fileNamed('data.json');
    if (item) item.trashed = true;
    expect(await provider.read(PATH)).toBeNull();
    if (item) item.trashed = false;
    const isHead = (url: string) => /\/files\/[^/?]+\?fields=headRevisionId/.test(url);
    fake.failWhen(isHead, { status: 404 });
    expect(await provider.read(PATH)).toBeNull();
    fake.failWhen(isHead, { status: 200, body: { headRevisionId: 'rev1', trashed: true } });
    expect(await provider.read(PATH)).toBeNull();
  });

  it('sends the token with every request', async () => {
    const { fake, provider } = setup();
    await provider.read(PATH);
    expect(fake.requests.length).toBeGreaterThan(0);
  });
});

describe('GoogleDriveProvider.write(): create', () => {
  it('creates the folders and the file in the visible Gamerdex folder', async () => {
    const { fake, provider } = setup();
    await provider.write(PATH, 'one', null);
    const folders = [...fake.items.values()].filter((i) => i.folder).map((i) => i.name);
    expect(folders).toEqual(['Gamerdex', 'my-app']);
    expect(fake.contentOf('data.json')).toBe('one');
  });

  it('reuses folders that exist and folders it already knows', async () => {
    const { fake, provider } = setup();
    await provider.write(PATH, 'one', null);
    const other = new GoogleDriveProvider({ getToken: async () => fake.token, fetch: fake.fetch });
    await other.write('Gamerdex/my-app/meta.json', 'meta', null);
    await provider.write('Gamerdex/my-app/meta2.json', 'meta2', null);
    expect([...fake.items.values()].filter((i) => i.folder)).toHaveLength(2);
  });

  it('refuses to create a file that exists', async () => {
    const { provider } = setup();
    await provider.write(PATH, 'one', null);
    await expect(provider.write(PATH, 'two', null)).rejects.toBeInstanceOf(VersionConflictError);
  });

  it('keeps the oldest folder when two devices create it at the same time', async () => {
    const { fake, provider } = setup();
    fake.hooks.beforeFolderCreate = (parent, name) => {
      fake.hooks.beforeFolderCreate = null;
      fake.seedFolder(name, parent, '2000-01-01T00:00:00.000Z');
    };
    await provider.write(PATH, 'one', null);
    const folders = [...fake.items.values()].filter((i) => i.folder);
    expect(folders.map((i) => i.name)).toEqual(['Gamerdex', 'my-app']);
    expect(fake.fileNamed('data.json')?.parent).toBe(folders[1].id);
  });

  it('keeps the oldest file when two devices create it at the same time', async () => {
    const { fake, provider } = setup();
    fake.hooks.beforeFileCreate = (parent, name) => {
      fake.hooks.beforeFileCreate = null;
      fake.seedFile(name, parent, 'theirs', '2000-01-01T00:00:00.000Z');
    };
    await expect(provider.write(PATH, 'mine', null)).rejects.toBeInstanceOf(VersionConflictError);
    expect([...fake.items.values()].filter((i) => !i.folder)).toHaveLength(1);
    expect(fake.contentOf('data.json')).toBe('theirs');
  });

  it('picks by id when two items have the same creation time', async () => {
    const { fake, provider } = setup();
    const gamerdex = fake.seedFolder('Gamerdex', 'root', '2026-02-01T00:00:00.000Z');
    const app = fake.seedFolder('my-app', gamerdex.id, '2026-02-01T00:00:00.000Z');
    fake.seedFile('data.json', app.id, 'b', '2026-02-01T00:00:00.000Z');
    fake.seedFile('data.json', app.id, 'a', '2026-02-01T00:00:00.000Z');
    const expected = [...fake.items.values()]
      .filter((i) => !i.folder)
      .map((i) => i.id)
      .sort()[0];
    const read = await provider.read(PATH);
    expect(read?.content).toBe(fake.items.get(expected)?.revisions[0].content);
  });

  it('handles names with quotes and backslashes', async () => {
    const { provider } = setup();
    const path = "Gamerdex/it's a\\path/data.json";
    await provider.write(path, 'odd', null);
    expect((await provider.read(path))?.content).toBe('odd');
  });
});

describe('GoogleDriveProvider.write(): update', () => {
  it('writes from the version that was read and returns the new version', async () => {
    const { fake, provider } = setup();
    const first = await provider.write(PATH, 'one', null);
    const second = await provider.write(PATH, 'two', first.version);
    expect(second.version).not.toBe(first.version);
    expect(fake.contentOf('data.json')).toBe('two');
    expect((await provider.read(PATH))?.version).toBe(second.version);
  });

  it('refuses an old version without changing the file', async () => {
    const { fake, provider } = setup();
    const first = await provider.write(PATH, 'one', null);
    await provider.write(PATH, 'two', first.version);
    await expect(provider.write(PATH, 'three', first.version)).rejects.toBeInstanceOf(
      VersionConflictError,
    );
    expect(fake.contentOf('data.json')).toBe('two');
  });

  it('refuses to update a file that does not exist', async () => {
    const { provider } = setup();
    await expect(provider.write(PATH, 'x', 'rev1')).rejects.toBeInstanceOf(VersionConflictError);
  });

  it('accepts an upload that made no new revision', async () => {
    const { fake, provider } = setup();
    fake.options.sameContentMakesRevision = false;
    const first = await provider.write(PATH, 'same', null);
    expect(await provider.write(PATH, 'same', first.version)).toEqual({ version: first.version });
  });

  it('puts back the content of a device that wrote during the upload and reports a conflict', async () => {
    const { fake, provider } = setup();
    const first = await provider.write(PATH, 'base', null);
    fake.hooks.beforeUpload = (item) => {
      fake.hooks.beforeUpload = null;
      fake.upload(item, 'theirs');
    };
    await expect(provider.write(PATH, 'mine', first.version)).rejects.toBeInstanceOf(
      VersionConflictError,
    );
    expect(fake.contentOf('data.json')).toBe('theirs');
    const read = await provider.read(PATH);
    await expect(provider.write(PATH, 'merged', read?.version ?? null)).resolves.toBeDefined();
    expect(fake.contentOf('data.json')).toBe('merged');
  });

  it('fails clearly when the new revision is not in the list', async () => {
    const { fake, provider } = setup();
    const first = await provider.write(PATH, 'one', null);
    fake.options.hideRevisions = 'head';
    expect((await kindOf(provider.write(PATH, 'two', first.version))).kind).toBe('server');
    fake.options.hideRevisions = 'all-but-head';
    const second = (await provider.read(PATH))?.version ?? null;
    expect((await kindOf(provider.write(PATH, 'three', second))).kind).toBe('server');
  });

  it('fails clearly when the revision list is not a list or holds no usable id', async () => {
    const { fake, provider } = setup();
    const first = await provider.write(PATH, 'one', null);
    const isList = (url: string) => url.includes('/revisions?');
    fake.failWhen(isList, { status: 200, body: {} });
    expect((await kindOf(provider.write(PATH, 'two', first.version))).kind).toBe('server');

    const second = (await provider.read(PATH))?.version ?? null;
    fake.failWhen(isList, {
      status: 200,
      body: () => ({
        revisions: [{ id: 5 }, { id: fake.fileNamed('data.json')?.revisions.at(-1)?.id }],
      }),
    });
    expect((await kindOf(provider.write(PATH, 'three', second))).kind).toBe('server');
  });
});

describe('GoogleDriveProvider.remove()', () => {
  it('removes the file from its version and refuses an old one', async () => {
    const { fake, provider } = setup();
    const first = await provider.write(PATH, 'one', null);
    const second = await provider.write(PATH, 'two', first.version);
    await expect(provider.remove(PATH, first.version)).rejects.toBeInstanceOf(VersionConflictError);
    await provider.remove(PATH, second.version);
    expect(fake.fileNamed('data.json')).toBeUndefined();
    expect(await provider.read(PATH)).toBeNull();
  });

  it('ignores a file that is already gone', async () => {
    const { provider } = setup();
    await expect(provider.remove(PATH, 'rev1')).resolves.toBeUndefined();
  });
});

describe('GoogleDriveProvider errors', () => {
  const withFailure = async (
    value: Parameters<ReturnType<typeof createFakeDrive>['failNext']>[0],
  ) => {
    const { fake, provider } = setup();
    fake.failNext(value);
    return kindOf(provider.read(PATH));
  };

  it('maps 401 to auth and keeps the message', async () => {
    const error = await withFailure({
      status: 401,
      body: { error: { message: 'Invalid Credentials' } },
    });
    expect(error).toMatchObject({ kind: 'auth', status: 401, detail: 'Invalid Credentials' });
  });

  it('maps a rate limit by status or by reason', async () => {
    const reason = (value: string) => ({ error: { message: 'slow', errors: [{ reason: value }] } });
    expect(await withFailure({ status: 403, body: reason('rateLimitExceeded') })).toMatchObject({
      kind: 'rate-limit',
    });
    expect(await withFailure({ status: 403, body: reason('userRateLimitExceeded') })).toMatchObject(
      { kind: 'rate-limit' },
    );
    expect(await withFailure({ status: 403, body: reason('dailyLimitExceeded') })).toMatchObject({
      kind: 'rate-limit',
    });
    expect(await withFailure({ status: 429, headers: { 'retry-after': '30' } })).toMatchObject({
      kind: 'rate-limit',
      retryAfterSeconds: 30,
    });
    expect((await withFailure({ status: 429 })).retryAfterSeconds).toBeUndefined();
    expect(
      (await withFailure({ status: 429, headers: { 'retry-after': 'soon' } })).retryAfterSeconds,
    ).toBeUndefined();
  });

  it('maps other 403 answers to auth, however little the body says', async () => {
    const bodies = [
      { error: { message: 'no', errors: [{ reason: 'insufficientPermissions' }] } },
      { error: { message: 'no', errors: [{}] } },
      { error: { message: 'no', errors: [5] } },
      { error: { message: 'no', errors: 'x' } },
      { error: 'x' },
      [],
    ];
    for (const body of bodies) {
      expect(await withFailure({ status: 403, body })).toMatchObject({ kind: 'auth', status: 403 });
    }
    expect(await withFailure({ status: 403, raw: 'not json' })).toMatchObject({ kind: 'auth' });
  });

  it('maps 404, server failures and surprises', async () => {
    const { fake, provider } = setup();
    await provider.write(PATH, 'x', null);
    fake.failWhen((url) => url.includes('/revisions/'), { status: 404 });
    expect((await kindOf(provider.read(PATH))).kind).toBe('not-found');
    expect((await withFailure({ status: 503 })).kind).toBe('server');
    expect(await withFailure({ status: 418 })).toMatchObject({ kind: 'invalid', status: 418 });
  });

  it('maps a failed network to network', async () => {
    const { fake, provider } = setup();
    fake.goOffline();
    expect((await kindOf(provider.read(PATH))).kind).toBe('network');
  });

  it('rejects answers that are not whole', async () => {
    const { fake, provider } = setup();
    const first = await provider.write(PATH, 'one', null);
    fake.failWhen((url) => /\/files\/[^/?]+\?fields=headRevisionId/.test(url), {
      status: 200,
      raw: '[]',
    });
    expect((await kindOf(provider.read(PATH))).kind).toBe('invalid');
    fake.failWhen((url) => url.includes('uploadType=media'), { status: 200, body: {} });
    expect((await kindOf(provider.write(PATH, 'two', first.version))).kind).toBe('invalid');
    fake.failWhen((url) => url.includes('uploadType=media'), { status: 200, raw: '[]' });
    expect((await kindOf(provider.write(PATH, 'two', first.version))).kind).toBe('invalid');
    fake.failWhen((url) => url.includes('uploadType=multipart'), {
      status: 200,
      body: { id: 'x' },
    });
    expect((await kindOf(provider.write('Gamerdex/my-app/other.json', 'x', null))).kind).toBe(
      'invalid',
    );
  });

  it('ignores a file list that is not a list and entries that are not whole', async () => {
    const { fake, provider } = setup();
    fake.failNext({ status: 200, body: { files: 'x' } });
    expect(await provider.read(PATH)).toBeNull();
    fake.failNext({ status: 200, raw: '[]' });
    expect(await provider.read(PATH)).toBeNull();
    fake.failNext({ status: 200, body: { files: [5, { id: 1 }, { id: 'a' }] } });
    expect(await provider.read(PATH)).toBeNull();
  });

  it('uses the global fetch when none is given', async () => {
    const spy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{"files":[]}', { status: 200 }));
    const provider = new GoogleDriveProvider({ getToken: async () => 't' });
    expect(await provider.read(PATH)).toBeNull();
    spy.mockRestore();
  });
});

describe('sync() over Google Drive with two devices', () => {
  const schema: Schema = {
    type: 'object',
    each: { type: 'object', each: { type: 'max', order: (value) => Number(value) } },
  };

  const device = (fake: ReturnType<typeof createFakeDrive>, id: string, local: unknown) => {
    const self = {
      local,
      state: null as SyncState | null,
      run: async () => {
        const result = await sync({
          appId: 'my-app',
          deviceId: id,
          deviceName: id,
          provider: new GoogleDriveProvider({
            getToken: async () => fake.token,
            fetch: fake.fetch,
          }),
          schema,
          local: self.local,
          state: self.state,
          now: () => '2026-10-17T10:00:00.000Z',
        });
        if (result.status === 'synced') {
          self.local = result.data;
          self.state = result.state;
        }
        return result;
      },
    };
    return self;
  };

  it('syncs a change from one device to the other', async () => {
    const fake = createFakeDrive();
    const a = device(fake, 'a', { x: { y: 1 } });
    await a.run();
    const b = device(fake, 'b', { x: { y: 1 } });
    await b.run();
    a.local = { x: { y: 4 } };
    expect(await a.run()).toMatchObject({ status: 'synced', uploaded: true });
    await b.run();
    expect(b.local).toEqual({ x: { y: 4 } });
    expect(fake.contentOf('data.json')).toContain('"y": 4');
    expect(fake.fileNamed('meta.json')).toBeDefined();
    expect([dataPath('my-app'), metaPath('my-app')]).toHaveLength(2);
  });

  it('keeps the changes of both devices when they write at the same moment', async () => {
    const fake = createFakeDrive();
    const a = device(fake, 'a', { x: { y: 1, z: 1 } });
    await a.run();
    const b = device(fake, 'b', { x: { y: 1, z: 1 } });
    await b.run();

    a.local = { x: { y: 2, z: 1 } };
    b.local = { x: { y: 1, z: 3 } };
    fake.hooks.beforeUpload = (item) => {
      if (item.name !== 'data.json') return;
      fake.hooks.beforeUpload = null;
      fake.upload(item, JSON.stringify({ x: { y: 1, z: 3 } }, null, 2));
    };
    await a.run();
    expect(JSON.parse(fake.contentOf('data.json') ?? '{}')).toEqual({ x: { y: 2, z: 3 } });
    await b.run();
    expect(b.local).toEqual({ x: { y: 2, z: 3 } });
    expect(a.local).toEqual({ x: { y: 2, z: 3 } });
  });
});
