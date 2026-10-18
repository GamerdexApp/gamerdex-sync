import { listInstalledRepositories } from '@/provider/repositories';
import { ProviderError } from '@/provider/types';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const stub = (routes: Record<string, () => Response>) => {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const send = (async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string> });
    const route = Object.entries(routes).find(([path]) => url.includes(path));
    if (!route) throw new Error(`no route for ${url}`);
    return route[1]();
  }) as unknown as typeof fetch;
  return { send, calls };
};

describe('listInstalledRepositories()', () => {
  it('lists the repositories of every installation', async () => {
    const { send, calls } = stub({
      '/user/installations?': () => json({ installations: [{ id: 1 }, { id: 2 }] }),
      '/installations/1/repositories': () =>
        json({ repositories: [{ full_name: 'me/data', private: true }] }),
      '/installations/2/repositories': () =>
        json({ repositories: [{ full_name: 'org/open', private: false }] }),
    });
    expect(await listInstalledRepositories('tok', send)).toEqual([
      { fullName: 'me/data', private: true },
      { fullName: 'org/open', private: false },
    ]);
    expect(calls[0].headers.Authorization).toBe('Bearer tok');
  });

  it('skips entries that are not whole', async () => {
    const { send } = stub({
      '/user/installations?': () => json({ installations: [{ id: 1 }, { id: 'x' }, 7, {}] }),
      '/installations/1/repositories': () =>
        json({
          repositories: [
            { full_name: 'me/data', private: true },
            { full_name: 3 },
            { private: true },
            'x',
          ],
        }),
    });
    expect(await listInstalledRepositories('tok', send)).toEqual([
      { fullName: 'me/data', private: true },
    ]);
  });

  it('returns an empty list when nothing is installed or the lists are missing', async () => {
    expect(
      await listInstalledRepositories('t', stub({ '/user/installations?': () => json({}) }).send),
    ).toEqual([]);
    const { send } = stub({
      '/user/installations?': () => json({ installations: [{ id: 1 }] }),
      '/installations/1/repositories': () => json({}),
    });
    expect(await listInstalledRepositories('t', send)).toEqual([]);
  });

  const kind = async (response: () => Response | Promise<Response>) => {
    const send = (async () => response()) as unknown as typeof fetch;
    const error = await listInstalledRepositories('t', send).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ProviderError);
    return (error as ProviderError).kind;
  };

  it('maps failures to error kinds', async () => {
    expect(await kind(() => json({}, 401))).toBe('auth');
    expect(await kind(() => json({}, 403))).toBe('auth');
    expect(await kind(() => json({}, 502))).toBe('server');
    expect(await kind(() => json({}, 418))).toBe('invalid');
    expect(await kind(() => new Response('not json'))).toBe('invalid');
    expect(await kind(() => json([]))).toBe('invalid');
    expect(
      await kind(() => {
        throw new TypeError('offline');
      }),
    ).toBe('network');
  });

  it('uses the global fetch when none is given', async () => {
    const spy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(json({ installations: [] }));
    expect(await listInstalledRepositories('t')).toEqual([]);
    spy.mockRestore();
  });
});
