import { MemoryProvider } from '@/provider/memory';
import { VersionConflictError } from '@/provider/types';

describe('MemoryProvider', () => {
  it('returns null for a file that does not exist', async () => {
    expect(await new MemoryProvider().read('a.json')).toBeNull();
  });

  it('creates a file only when none exists and returns its version', async () => {
    const provider = new MemoryProvider();
    const { version } = await provider.write('a.json', 'one', null);
    expect(await provider.read('a.json')).toEqual({ content: 'one', version });
    await expect(provider.write('a.json', 'two', null)).rejects.toBeInstanceOf(
      VersionConflictError,
    );
  });

  it('updates a file from the version that was read and refuses an old version', async () => {
    const provider = new MemoryProvider();
    const first = await provider.write('a.json', 'one', null);
    const second = await provider.write('a.json', 'two', first.version);
    expect(second.version).not.toBe(first.version);
    await expect(provider.write('a.json', 'three', first.version)).rejects.toThrow(
      'The file a.json changed in the cloud.',
    );
    expect((await provider.read('a.json'))?.content).toBe('two');
  });

  it('refuses to update a file that does not exist', async () => {
    await expect(new MemoryProvider().write('a.json', 'x', '1')).rejects.toBeInstanceOf(
      VersionConflictError,
    );
  });

  it('removes a file from its version and refuses an old one', async () => {
    const provider = new MemoryProvider();
    const first = await provider.write('a.json', 'one', null);
    const second = await provider.write('a.json', 'two', first.version);
    await expect(provider.remove('a.json', first.version)).rejects.toBeInstanceOf(
      VersionConflictError,
    );
    await provider.remove('a.json', second.version);
    expect(await provider.read('a.json')).toBeNull();
    expect(provider.paths()).toEqual([]);
  });

  it('removes a file that is already gone without an error', async () => {
    await expect(new MemoryProvider().remove('a.json', '1')).resolves.toBeUndefined();
  });

  it('lists the paths of the files it holds', async () => {
    const provider = new MemoryProvider();
    await provider.write('b.json', 'b', null);
    await provider.write('a.json', 'a', null);
    expect(provider.paths()).toEqual(['b.json', 'a.json']);
  });
});
