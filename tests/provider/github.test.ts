import { GitHubProvider } from '@/provider/github';
import { ProviderError, VersionConflictError } from '@/provider/types';
import { createFakeGitHub } from './fakeGitHub';

const setup = (extra: Partial<ConstructorParameters<typeof GitHubProvider>[0]> = {}) => {
  const fake = createFakeGitHub();
  const getToken = jest.fn(async () => fake.token);
  const provider = new GitHubProvider({
    repository: 'owner/data',
    getToken,
    fetch: fake.fetch,
    ...extra,
  });
  return { fake, provider, getToken };
};

const kindOf = async (action: Promise<unknown>) => {
  const error = await action.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ProviderError);
  return error as ProviderError;
};

describe('GitHubProvider.read()', () => {
  it('returns null for a file that does not exist', async () => {
    expect(await setup().provider.read('Gamerdex/app/data.json')).toBeNull();
  });

  it('returns the decoded content and the sha as the version', async () => {
    const { fake, provider } = setup();
    const sha = fake.put('Gamerdex/app/data.json', '{"name":"Ünï 🙂"}');
    expect(await provider.read('Gamerdex/app/data.json')).toEqual({
      content: '{"name":"Ünï 🙂"}',
      version: sha,
    });
  });

  it('asks for the raw content of a large file', async () => {
    const { fake, provider } = setup();
    const sha = fake.put('big.json', 'x'.repeat(100));
    fake.markLarge('big.json');
    expect(await provider.read('big.json')).toEqual({ content: 'x'.repeat(100), version: sha });
    expect(fake.requests.map((request) => request.headers.Accept)).toEqual([
      'application/vnd.github+json',
      'application/vnd.github.raw+json',
    ]);
  });

  it('sends the token, the media type and the API version', async () => {
    const { fake, provider, getToken } = setup();
    await provider.read('a.json');
    expect(fake.requests[0].headers).toMatchObject({
      Authorization: 'Bearer token-1',
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    });
    expect(getToken).toHaveBeenCalledTimes(1);
  });

  it('encodes each part of the path and adds the branch', async () => {
    const { fake, provider } = setup({ branch: 'sync' });
    await provider.read('Gamerdex/my app/data.json');
    expect(fake.requests[0].url).toBe(
      'https://api.github.com/repos/owner/data/contents/Gamerdex/my%20app/data.json?ref=sync',
    );
  });

  it('rejects an answer without a version or with an unknown encoding', async () => {
    const { fake, provider } = setup();
    fake.failNext({ status: 200, body: { content: 'x', encoding: 'base64' } });
    expect((await kindOf(provider.read('a.json'))).kind).toBe('invalid');
    fake.put('a.json', 'x');
    fake.failNext({ status: 200, body: { sha: '1', content: 'x', encoding: 'utf-16' } });
    expect((await kindOf(provider.read('a.json'))).kind).toBe('invalid');
    fake.failNext({ status: 200, body: { sha: '1', content: 5, encoding: 'base64' } });
    expect((await kindOf(provider.read('a.json'))).kind).toBe('invalid');
  });
});

describe('GitHubProvider.write()', () => {
  it('creates a file and updates it from its version', async () => {
    const { fake, provider } = setup();
    const first = await provider.write('a.json', 'one', null);
    expect(fake.files.get('a.json')?.content).toBe('one');
    expect(fake.requests[0].body).toEqual({
      message: 'Gamerdex sync: a.json',
      content: Buffer.from('one').toString('base64'),
    });
    const second = await provider.write('a.json', 'two', first.version);
    expect(second.version).not.toBe(first.version);
    expect(fake.requests[1].body?.sha).toBe(first.version);
  });

  it('refuses to create a file that exists and to update from an old version', async () => {
    const { fake, provider } = setup();
    fake.put('a.json', 'one');
    await expect(provider.write('a.json', 'two', null)).rejects.toBeInstanceOf(
      VersionConflictError,
    );
    await expect(provider.write('a.json', 'two', 'old')).rejects.toBeInstanceOf(
      VersionConflictError,
    );
    expect(fake.files.get('a.json')?.content).toBe('one');
  });

  it('uses the commit message and the branch of the options', async () => {
    const { fake, provider } = setup({ branch: 'sync', commitMessage: (path) => `save ${path}` });
    await provider.write('a.json', 'x', null);
    expect(fake.requests[0].body).toMatchObject({ message: 'save a.json', branch: 'sync' });
  });

  it('rejects an answer without a version', async () => {
    const { fake, provider } = setup();
    fake.failNext({ status: 200, body: {} });
    expect((await kindOf(provider.write('a.json', 'x', null))).kind).toBe('invalid');
  });
});

describe('GitHubProvider.remove()', () => {
  it('removes a file from its version', async () => {
    const { fake, provider } = setup({ branch: 'sync' });
    const sha = fake.put('a.json', 'one');
    await provider.remove('a.json', sha);
    expect(fake.files.has('a.json')).toBe(false);
    expect(fake.requests[0].body).toMatchObject({ sha, branch: 'sync' });
  });

  it('refuses an old version and ignores a file that is already gone', async () => {
    const { fake, provider } = setup();
    fake.put('a.json', 'one');
    await expect(provider.remove('a.json', 'old')).rejects.toBeInstanceOf(VersionConflictError);
    await expect(provider.remove('gone.json', 'x')).resolves.toBeUndefined();
    fake.failNext({ status: 422, body: {} });
    await expect(provider.remove('a.json', 'x')).rejects.toBeInstanceOf(VersionConflictError);
  });

  it('sends no branch when none is set', async () => {
    const { fake, provider } = setup();
    const sha = fake.put('a.json', 'one');
    await provider.remove('a.json', sha);
    expect(fake.requests[0].body).not.toHaveProperty('branch');
  });
});

describe('GitHubProvider errors', () => {
  it('maps a bad token to auth', async () => {
    const { provider } = setup({ getToken: async () => 'wrong' });
    expect((await kindOf(provider.read('a.json'))).kind).toBe('auth');
  });

  it('maps a forbidden call to auth and a limited call to rate-limit', async () => {
    const { fake, provider } = setup();
    fake.failNext({ status: 403, body: {} });
    const forbidden = await kindOf(provider.read('a.json'));
    expect(forbidden).toMatchObject({ kind: 'auth', status: 403 });
    fake.failNext({ status: 403, headers: { 'x-ratelimit-remaining': '0', 'retry-after': '60' } });
    expect(await kindOf(provider.read('a.json'))).toMatchObject({
      kind: 'rate-limit',
      retryAfterSeconds: 60,
    });
    fake.failNext({ status: 429 });
    expect(await kindOf(provider.read('a.json'))).toMatchObject({
      kind: 'rate-limit',
      retryAfterSeconds: undefined,
    });
  });

  it('reads the time of the limit reset when there is no retry-after', async () => {
    const { fake, provider } = setup();
    const now = Math.floor(Date.now() / 1000);
    fake.failNext({ status: 429, headers: { 'x-ratelimit-reset': String(now + 120) } });
    const soon = await kindOf(provider.read('a.json'));
    expect(soon.retryAfterSeconds).toBeGreaterThan(100);
    fake.failNext({ status: 429, headers: { 'x-ratelimit-reset': String(now - 50) } });
    expect((await kindOf(provider.read('a.json'))).retryAfterSeconds).toBe(0);
    fake.failNext({
      status: 429,
      headers: { 'retry-after': 'soon', 'x-ratelimit-reset': 'later' },
    });
    expect((await kindOf(provider.read('a.json'))).retryAfterSeconds).toBeUndefined();
  });

  it('maps a missing repository, a server failure and a surprise', async () => {
    const { fake, provider } = setup();
    fake.failNext({ status: 404 });
    expect((await kindOf(provider.write('a.json', 'x', null))).kind).toBe('not-found');
    fake.failNext({ status: 503 });
    expect((await kindOf(provider.read('a.json'))).kind).toBe('server');
    fake.failNext({ status: 418 });
    expect(await kindOf(provider.read('a.json'))).toMatchObject({ kind: 'invalid', status: 418 });
  });

  it('maps a failed network to network', async () => {
    const { fake, provider } = setup();
    fake.goOffline();
    expect((await kindOf(provider.read('a.json'))).kind).toBe('network');
  });

  it('uses the global fetch when none is given', async () => {
    const spy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 404 }));
    const provider = new GitHubProvider({ repository: 'owner/data', getToken: async () => 't' });
    expect(await provider.read('a.json')).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe('GitHubProvider.checkRepository()', () => {
  it('reports a private repository that the token can write to', async () => {
    expect(await setup().provider.checkRepository()).toEqual({
      private: true,
      canWrite: true,
      defaultBranch: 'main',
    });
  });

  it('reports a public repository, a token that cannot write and a default branch', async () => {
    const { fake, provider } = setup();
    fake.setRepository({ private: false, permissions: { push: false }, default_branch: 'trunk' });
    expect(await provider.checkRepository()).toEqual({
      private: false,
      canWrite: false,
      defaultBranch: 'trunk',
    });
    fake.setRepository({ private: true });
    expect(await provider.checkRepository()).toEqual({
      private: true,
      canWrite: false,
      defaultBranch: 'main',
    });
  });

  it('rejects an answer that is not a repository and maps a missing one', async () => {
    const { fake, provider } = setup();
    fake.setRepository({ name: 'x' });
    expect((await kindOf(provider.checkRepository())).kind).toBe('invalid');
    fake.failNext({ status: 200, body: [] });
    expect((await kindOf(provider.checkRepository())).kind).toBe('invalid');
    fake.failNext({ status: 404 });
    expect((await kindOf(provider.checkRepository())).kind).toBe('not-found');
  });
});
