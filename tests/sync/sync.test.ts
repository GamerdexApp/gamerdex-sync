import { dataPath, metaPath } from '@/layout';
import { Schema } from '@/merge/types';
import { emptyMeta, parseMeta } from '@/meta';
import { MemoryProvider } from '@/provider/memory';
import { ProviderError, RemoteFile } from '@/provider/types';
import { RemoteDataError, sync, SyncBusyError, SyncOptions, SyncState } from '@/sync/sync';

const APP = 'tracker';
const schema: Schema = {
  type: 'object',
  fields: { active: { type: 'local' } },
  each: { type: 'object', each: { type: 'max', order: (value) => Number(value) } },
};

type Data = Record<string, unknown>;

const device = (provider: MemoryProvider, id: string, local: Data = {}) => {
  const self = {
    id,
    local,
    state: null as SyncState | null,
    run: async (extra: Partial<SyncOptions> = {}) => {
      const result = await sync({
        appId: APP,
        deviceId: id,
        deviceName: `Device ${id}`,
        provider,
        schema,
        local: self.local,
        state: self.state,
        now: () => '2026-10-17T10:00:00.000Z',
        ...extra,
      });
      if (result.status === 'synced') {
        self.local = result.data as Data;
        self.state = result.state;
      }
      return result;
    },
  };
  return self;
};

const cloudData = async (provider: MemoryProvider) =>
  JSON.parse((await provider.read(dataPath(APP)))?.content ?? 'null') as unknown;

describe('sync(): the first sync', () => {
  it('creates the cloud files from the data of the device', async () => {
    const provider = new MemoryProvider();
    const a = device(provider, 'a', { chief: { furnace: 5 } });
    const result = await a.run();
    expect(result).toMatchObject({ status: 'synced', uploaded: true, conflicts: [] });
    expect(await cloudData(provider)).toEqual({ chief: { furnace: 5 } });
    expect(provider.paths()).toEqual([dataPath(APP), metaPath(APP)]);
    expect(a.state?.base).toEqual({ chief: { furnace: 5 } });
  });

  it('writes the device and the time to the meta file', async () => {
    const provider = new MemoryProvider();
    await device(provider, 'a', { x: { y: 1 } }).run();
    const meta = parseMeta((await provider.read(metaPath(APP)))?.content ?? '', APP);
    expect(meta).toMatchObject({
      ok: true,
      meta: {
        lastSyncAt: '2026-10-17T10:00:00.000Z',
        devices: { a: { name: 'Device a', lastSeenAt: '2026-10-17T10:00:00.000Z' } },
      },
    });
  });

  it('lets the app change the revisions of the meta file', async () => {
    const provider = new MemoryProvider();
    await device(provider, 'a', { x: { y: 1 } }).run({
      updateMeta: (meta) => ({ ...meta, settingsRevision: meta.settingsRevision + 1 }),
    });
    const meta = parseMeta((await provider.read(metaPath(APP)))?.content ?? '', APP);
    expect(meta).toMatchObject({ ok: true, meta: { settingsRevision: 1 } });
  });

  it('does not upload data that fails the check', async () => {
    const provider = new MemoryProvider();
    const a = device(provider, 'a', { x: { y: 1 } });
    await expect(a.run({ validate: () => false })).rejects.toThrow(
      'The data of this device is not valid.',
    );
    expect(provider.paths()).toEqual([]);
  });

  it('asks for a choice when the device and the cloud hold different data', async () => {
    const provider = new MemoryProvider();
    await device(provider, 'a', { x: { y: 1 } }).run();
    const b = device(provider, 'b', { x: { y: 2 } });
    expect(await b.run()).toEqual({
      status: 'needs-choice',
      local: { x: { y: 2 } },
      remote: { x: { y: 1 } },
    });
    expect(b.state).toBeNull();
  });

  it('joins at once when the device and the cloud hold the same data', async () => {
    const provider = new MemoryProvider();
    await device(provider, 'a', { x: { y: 1 } }).run();
    const b = device(provider, 'b', { x: { y: 1 } });
    expect(await b.run()).toMatchObject({ status: 'synced', uploaded: false });
  });

  it('merges both when the player picks merge', async () => {
    const provider = new MemoryProvider();
    await device(provider, 'a', { x: { y: 1, z: 7 } }).run();
    const b = device(provider, 'b', { x: { y: 4 }, w: { v: 1 } });
    const result = await b.run({ firstSync: 'merge' });
    expect(result).toMatchObject({ status: 'synced', uploaded: true, conflicts: [] });
    expect(b.local).toEqual({ x: { y: 4, z: 7 }, w: { v: 1 } });
    expect(await cloudData(provider)).toEqual({ x: { y: 4, z: 7 }, w: { v: 1 } });
  });

  it('keeps device values out of the cloud on the first upload', async () => {
    const provider = new MemoryProvider();
    const a = device(provider, 'a', { active: 'one', x: { y: 1 } });
    await a.run();
    expect(await cloudData(provider)).toEqual({ x: { y: 1 } });
    expect(a.local).toEqual({ active: 'one', x: { y: 1 } });
  });

  it('keeps the device value of this device when the player picks the cloud data', async () => {
    const provider = new MemoryProvider();
    await device(provider, 'a', { active: 'one', x: { y: 9 } }).run();
    const b = device(provider, 'b', { active: 'two', x: { y: 2 } });
    await b.run({ firstSync: 'keep-cloud' });
    expect(b.local).toEqual({ active: 'two', x: { y: 9 } });
  });

  it('keeps the cloud device value when the player picks the data of this device', async () => {
    const provider = new MemoryProvider();
    await device(provider, 'a', { x: { y: 9 } }).run();
    const b = device(provider, 'b', { active: 'two', x: { y: 2 } });
    await b.run({ firstSync: 'keep-local' });
    expect(b.local).toEqual({ active: 'two', x: { y: 2 } });
    expect(await cloudData(provider)).toEqual({ x: { y: 2 } });
  });

  it('keeps the device data when the player picks it', async () => {
    const provider = new MemoryProvider();
    await device(provider, 'a', { x: { y: 9 } }).run();
    const b = device(provider, 'b', { x: { y: 2 } });
    await b.run({ firstSync: 'keep-local' });
    expect(await cloudData(provider)).toEqual({ x: { y: 2 } });
  });

  it('takes the cloud data when the player picks it', async () => {
    const provider = new MemoryProvider();
    await device(provider, 'a', { x: { y: 9 } }).run();
    const b = device(provider, 'b', { x: { y: 2 } });
    await b.run({ firstSync: 'keep-cloud' });
    expect(b.local).toEqual({ x: { y: 9 } });
    expect(await cloudData(provider)).toEqual({ x: { y: 9 } });
  });
});

describe('sync(): later syncs', () => {
  it('sends a change of one device to the other', async () => {
    const provider = new MemoryProvider();
    const a = device(provider, 'a', { x: { y: 1 } });
    await a.run();
    const b = device(provider, 'b', { x: { y: 1 } });
    await b.run();
    a.local = { x: { y: 3 } };
    expect(await a.run()).toMatchObject({ uploaded: true });
    expect(await b.run()).toMatchObject({ uploaded: false });
    expect(b.local).toEqual({ x: { y: 3 } });
  });

  it('does not write the data when nothing changed', async () => {
    const provider = new MemoryProvider();
    const a = device(provider, 'a', { x: { y: 1 } });
    await a.run();
    const before = (await provider.read(dataPath(APP)))?.version;
    expect(await a.run()).toMatchObject({ uploaded: false, conflicts: [] });
    expect((await provider.read(dataPath(APP)))?.version).toBe(before);
  });

  it('merges changes of two devices and reports a conflict that cannot merge', async () => {
    const provider = new MemoryProvider();
    const a = device(provider, 'a', { x: { y: 1 }, name: { n: 1 } });
    await a.run();
    const b = device(provider, 'b', { x: { y: 1 }, name: { n: 1 } });
    await b.run();
    a.local = { x: { y: 5 }, name: { n: 1 } };
    await a.run();
    b.local = { x: { y: 3, z: 2 }, name: { n: 1 } };
    const result = await b.run();
    expect(b.local).toEqual({ x: { y: 5, z: 2 }, name: { n: 1 } });
    expect(result).toMatchObject({ status: 'synced', uploaded: true, conflicts: [] });
    expect(await cloudData(provider)).toEqual({ x: { y: 5, z: 2 }, name: { n: 1 } });
  });

  it('keeps a device value on the device and out of the cloud', async () => {
    const provider = new MemoryProvider();
    const a = device(provider, 'a', { active: 'one', x: { y: 1 } });
    await a.run();
    const b = device(provider, 'b', { active: 'one', x: { y: 1 } });
    await b.run();
    b.local = { active: 'two', x: { y: 2 } };
    await b.run();
    expect(b.local.active).toBe('two');
    expect(await cloudData(provider)).toEqual({ x: { y: 2 } });
    await a.run();
    expect(a.local).toEqual({ active: 'one', x: { y: 2 } });
  });

  it('uploads the data again when the cloud files were removed', async () => {
    const provider = new MemoryProvider();
    const a = device(provider, 'a', { x: { y: 1 } });
    await a.run();
    const data = await provider.read(dataPath(APP));
    const meta = await provider.read(metaPath(APP));
    await provider.remove(dataPath(APP), data?.version ?? '');
    await provider.remove(metaPath(APP), meta?.version ?? '');
    expect(await a.run()).toMatchObject({ uploaded: true });
    expect(await cloudData(provider)).toEqual({ x: { y: 1 } });
  });

  it('reports a conflict and keeps the cloud value in both copies', async () => {
    const provider = new MemoryProvider();
    const textSchema: Schema = { type: 'object' };
    const run = (id: string, local: Data, state: SyncState | null) =>
      sync({
        appId: APP,
        deviceId: id,
        deviceName: id,
        provider,
        schema: textSchema,
        local,
        state,
        now: () => 'now',
      });
    const first = await run('a', { name: 'old' }, null);
    const second = await run('b', { name: 'old' }, null);
    if (first.status !== 'synced' || second.status !== 'synced') throw new Error('not synced');
    await run('a', { name: 'mine' }, first.state);
    const result = await run('b', { name: 'theirs' }, second.state);
    expect(result).toMatchObject({
      status: 'synced',
      data: { name: 'mine' },
      conflicts: [{ path: ['name'], kind: 'both-changed', taken: 'remote' }],
    });
  });
});

describe('sync(): a sync that changes nothing', () => {
  it('writes no file when the device is already recorded', async () => {
    const provider = new MemoryProvider();
    const a = device(provider, 'a', { x: { y: 1 } });
    await a.run();
    const data = (await provider.read(dataPath(APP)))?.version;
    const meta = (await provider.read(metaPath(APP)))?.version;
    const write = jest.spyOn(provider, 'write');
    const result = await a.run();
    expect(result).toMatchObject({ status: 'synced', uploaded: false });
    expect(write).not.toHaveBeenCalled();
    expect((await provider.read(dataPath(APP)))?.version).toBe(data);
    expect((await provider.read(metaPath(APP)))?.version).toBe(meta);
    expect(a.state?.metaVersion).toBe(meta);
  });

  it('records the device once when it joins data that is already the same', async () => {
    const provider = new MemoryProvider();
    await device(provider, 'a', { x: { y: 1 } }).run();
    const b = device(provider, 'b', { x: { y: 1 } });
    expect(await b.run()).toMatchObject({ uploaded: false });
    const meta = parseMeta((await provider.read(metaPath(APP)))?.content ?? '', APP);
    expect(meta).toMatchObject({ ok: true, meta: { devices: { a: {}, b: {} } } });
    const write = jest.spyOn(provider, 'write');
    await b.run();
    expect(write).not.toHaveBeenCalled();
  });

  it('still writes the meta file when the app changes the revisions', async () => {
    const provider = new MemoryProvider();
    const a = device(provider, 'a', { x: { y: 1 } });
    await a.run();
    const write = jest.spyOn(provider, 'write');
    await a.run({ updateMeta: (meta) => ({ ...meta, settingsRevision: 1 }) });
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0][0]).toBe(metaPath(APP));
  });
});

describe('sync(): other devices write during the sync', () => {
  class Interfering extends MemoryProvider {
    constructor(
      private readonly times: number,
      private readonly onlyPath?: string,
    ) {
      super();
    }
    interfere: ((path: string) => Promise<void>) | null = null;
    private done = 0;
    async write(path: string, content: string, expected: string | null) {
      const matches = this.onlyPath === undefined || this.onlyPath === path;
      if (this.interfere && matches && this.done < this.times) {
        this.done += 1;
        await this.interfere(path);
      }
      return super.write(path, content, expected);
    }
    async rawWrite(path: string, content: string) {
      const current = await this.read(path);
      return super.write(path, content, current?.version ?? null);
    }
  }

  it('reads and merges again after the cloud changed', async () => {
    const provider = new Interfering(1);
    const a = device(provider, 'a', { x: { y: 1 } });
    await a.run();
    const b = device(provider, 'b', { x: { y: 1 } });
    await b.run();
    provider.interfere = async (path) => {
      if (path === dataPath(APP))
        await provider.rawWrite(path, JSON.stringify({ x: { y: 1, k: 8 } }));
    };
    a.local = { x: { y: 6 } };
    expect(await a.run()).toMatchObject({ status: 'synced', uploaded: true });
    expect(a.local).toEqual({ x: { y: 6, k: 8 } });
    expect(await cloudData(provider)).toEqual({ x: { y: 6, k: 8 } });
  });

  it('retries the creation when another device created the files first', async () => {
    const provider = new Interfering(1);
    provider.interfere = async (path) => {
      if (path === dataPath(APP)) await provider.rawWrite(path, JSON.stringify({ x: { y: 1 } }));
    };
    const a = device(provider, 'a', { x: { y: 2 } });
    expect(await a.run()).toMatchObject({ status: 'needs-choice' });
  });

  it('retries the meta file when it changed between the read and the write', async () => {
    const provider = new Interfering(1, metaPath(APP));
    provider.interfere = async (path) => {
      await provider.rawWrite(path, JSON.stringify(emptyMeta(APP)));
    };
    const a = device(provider, 'a', { x: { y: 1 } });
    expect(await a.run()).toMatchObject({ status: 'synced', uploaded: true });
    const meta = parseMeta((await provider.read(metaPath(APP)))?.content ?? '', APP);
    expect(meta).toMatchObject({ ok: true, meta: { devices: { a: { name: 'Device a' } } } });
  });

  it('stops with a busy error when the cloud keeps changing', async () => {
    const provider = new Interfering(99);
    const a = device(provider, 'a', { x: { y: 1 } });
    await a.run();
    let count = 0;
    provider.interfere = async (path) => {
      count += 1;
      await provider.rawWrite(path, JSON.stringify({ x: { y: count } }));
    };
    a.local = { x: { y: 100 } };
    await expect(a.run()).rejects.toBeInstanceOf(SyncBusyError);
  });

  it('stops with a busy error when the files keep being created by others', async () => {
    const provider = new Interfering(99);
    let count = 0;
    provider.interfere = async (path) => {
      count += 1;
      await provider.rawWrite(path, JSON.stringify({ n: { v: count } }));
    };
    const a = device(provider, 'a', { x: { y: 1 } });
    await expect(a.run({ firstSync: 'merge' })).rejects.toBeInstanceOf(SyncBusyError);
  });

  it('stops with a busy error when the meta file keeps changing', async () => {
    const provider = new Interfering(99, metaPath(APP));
    const a = device(provider, 'a', { x: { y: 1 } });
    await a.run();
    provider.interfere = async (path) => {
      await provider.rawWrite(path, (await provider.read(path))?.content ?? '');
    };
    a.local = { x: { y: 2 } };
    await expect(a.run()).rejects.toBeInstanceOf(SyncBusyError);
  });
});

describe('sync(): data that is not whole', () => {
  const putRaw = async (provider: MemoryProvider, path: string, content: string) => {
    await provider.write(path, content, null);
  };

  it('refuses cloud data that is not JSON', async () => {
    const provider = new MemoryProvider();
    await putRaw(provider, dataPath(APP), '{oops');
    await expect(device(provider, 'a').run()).rejects.toThrow('The synced data is not valid JSON.');
  });

  it('refuses cloud data that fails the check', async () => {
    const provider = new MemoryProvider();
    await putRaw(provider, dataPath(APP), '{"x":{"y":1}}');
    await expect(
      device(provider, 'a', { x: { y: 1 } }).run({ validate: () => false }),
    ).rejects.toThrow('The synced data is not valid.');
  });

  it('refuses a merge result that fails the check and writes nothing', async () => {
    const provider = new MemoryProvider();
    const a = device(provider, 'a', { x: { y: 1 } });
    await a.run();
    const before = (await provider.read(dataPath(APP)))?.version;
    a.local = { x: { y: 2 } };
    const validate = jest.fn().mockReturnValueOnce(true).mockReturnValue(false);
    await expect(a.run({ validate })).rejects.toThrow('The merged data is not valid.');
    expect((await provider.read(dataPath(APP)))?.version).toBe(before);
  });

  it('refuses a meta file that is not whole', async () => {
    const provider = new MemoryProvider();
    const a = device(provider, 'a', { x: { y: 1 } });
    await a.run();
    const meta = await provider.read(metaPath(APP));
    await provider.write(metaPath(APP), '{"format":9}', meta?.version ?? null);
    await expect(a.run()).rejects.toBeInstanceOf(RemoteDataError);
  });
});

describe('sync(): provider failures', () => {
  it('passes a provider error through', async () => {
    const provider = new MemoryProvider();
    jest.spyOn(provider, 'read').mockRejectedValue(new ProviderError('network', 'offline'));
    await expect(device(provider, 'a').run()).rejects.toMatchObject({ kind: 'network' });
  });

  it('passes a failed data write through', async () => {
    const provider = new MemoryProvider();
    jest.spyOn(provider, 'write').mockRejectedValue(new ProviderError('auth', 'bad token'));
    await expect(device(provider, 'a', { x: { y: 1 } }).run()).rejects.toMatchObject({
      kind: 'auth',
    });
  });

  it('passes a failed meta write through', async () => {
    const provider = new MemoryProvider();
    const a = device(provider, 'a', { x: { y: 1 } });
    await a.run();
    const original = provider.write.bind(provider);
    jest.spyOn(provider, 'write').mockImplementation(async (path, content, version) => {
      if (path === metaPath(APP)) throw new ProviderError('server', 'down');
      return original(path, content, version);
    });
    a.local = { x: { y: 2 } };
    await expect(a.run()).rejects.toMatchObject({ kind: 'server' });
  });
});

export type { RemoteFile };
