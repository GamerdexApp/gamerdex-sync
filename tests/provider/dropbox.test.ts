import { DropboxProvider } from '@/provider/dropbox';
import { ProviderError, VersionConflictError } from '@/provider/types';
import { createFakeDropbox } from './fakeDropbox';

const setup = (options: Parameters<typeof createFakeDropbox>[0] = {}) => {
  const fake = createFakeDropbox(options);
  const getToken = jest.fn(async () => fake.token);
  const provider = new DropboxProvider({ getToken, fetch: fake.fetch });
  return { fake, provider, getToken };
};

const failureOf = async (action: Promise<unknown>) => {
  const error = await action.then(
    () => null,
    (caught: unknown) => caught,
  );
  return error;
};

const providerErrorOf = async (action: Promise<unknown>) => {
  const error = await failureOf(action);
  expect(error).toBeInstanceOf(ProviderError);
  return error as ProviderError;
};

describe('DropboxProvider.read()', () => {
  it('returns null for a file that does not exist', async () => {
    expect(await setup().provider.read('Gamerdex/app/data.json')).toBeNull();
  });

  it('returns the content and the revision as the version', async () => {
    const { fake, provider } = setup();
    const rev = fake.put('Gamerdex/app/data.json', '{"name":"Ünï 🙂"}');
    expect(await provider.read('Gamerdex/app/data.json')).toEqual({
      content: '{"name":"Ünï 🙂"}',
      version: rev,
    });
  });

  it('sends the path with a leading slash and the token for every request', async () => {
    const { fake, provider, getToken } = setup();
    await provider.read('Gamerdex/app/data.json');
    expect(fake.requests[0].url).toBe('https://content.dropboxapi.com/2/files/download');
    expect(fake.requests[0].arg).toEqual({ path: '/Gamerdex/app/data.json' });
    expect(fake.requests[0].headers.Authorization).toBe('Bearer token-1');
    expect(getToken).toHaveBeenCalledTimes(1);
  });

  it('writes a character outside ASCII as an escape in the header', async () => {
    const { fake, provider } = setup();
    await provider.read('Gamerdex/café/data.json');
    expect(fake.requests[0].headers['Dropbox-API-Arg']).toBe(
      '{"path":"/Gamerdex/caf\\u00e9/data.json"}',
    );
  });

  it('refuses an answer without a revision', async () => {
    const { fake, provider } = setup();
    fake.failNext({ status: 200, raw: 'x', headers: { 'dropbox-api-result': '{}' } });
    expect(await providerErrorOf(provider.read('a.json'))).toMatchObject({
      kind: 'invalid',
      message: 'The file has no version.',
    });
  });

  it('refuses an answer with no result header', async () => {
    const { fake, provider } = setup();
    fake.failNext({ status: 200, raw: 'x' });
    expect((await providerErrorOf(provider.read('a.json'))).kind).toBe('invalid');
  });

  it('fails when the call fails in a way that is not a missing file', async () => {
    const { fake, provider } = setup();
    fake.failNext({ status: 409, body: { error: { '.tag': 'unsupported_file' } } });
    expect(await providerErrorOf(provider.read('a.json'))).toMatchObject({
      kind: 'invalid',
      status: 409,
    });
  });
});

describe('DropboxProvider.write()', () => {
  it('creates a file in add mode and returns the revision', async () => {
    const { fake, provider } = setup();
    const result = await provider.write('Gamerdex/app/data.json', '{"a":1}', null);
    expect(result).toEqual({ version: 'rev1' });
    expect(fake.files.get('Gamerdex/app/data.json')).toEqual({ content: '{"a":1}', rev: 'rev1' });
    expect(fake.requests[0].arg).toEqual({
      path: '/Gamerdex/app/data.json',
      mode: { '.tag': 'add' },
      autorename: false,
      mute: true,
      strict_conflict: true,
    });
    expect(fake.requests[0].headers['Content-Type']).toBe('application/octet-stream');
  });

  it('updates a file with the revision that was read', async () => {
    const { fake, provider } = setup();
    const rev = fake.put('a.json', 'old');
    expect(await provider.write('a.json', 'new', rev)).toEqual({ version: 'rev2' });
    expect(fake.files.get('a.json')?.content).toBe('new');
    expect(fake.requests[0].arg?.mode).toEqual({ '.tag': 'update', update: rev });
  });

  it('throws a version conflict when a file to create exists', async () => {
    const { fake, provider } = setup();
    fake.put('a.json', 'other');
    await expect(provider.write('a.json', 'mine', null)).rejects.toBeInstanceOf(
      VersionConflictError,
    );
    expect(fake.files.get('a.json')?.content).toBe('other');
  });

  it('throws a version conflict when the file changed since it was read', async () => {
    const { fake, provider } = setup();
    const rev = fake.put('a.json', 'old');
    fake.put('a.json', 'other device');
    await expect(provider.write('a.json', 'mine', rev)).rejects.toBeInstanceOf(
      VersionConflictError,
    );
    expect(fake.files.get('a.json')?.content).toBe('other device');
  });

  it('throws a version conflict when the file was removed since it was read', async () => {
    const { provider } = setup();
    await expect(provider.write('a.json', 'mine', 'rev9')).rejects.toBeInstanceOf(
      VersionConflictError,
    );
  });

  it('refuses an answer without a revision', async () => {
    const { fake, provider } = setup();
    fake.failNext({ status: 200, body: {} });
    expect(await providerErrorOf(provider.write('a.json', 'x', null))).toMatchObject({
      kind: 'invalid',
      message: 'The write returned no version.',
    });
  });

  it('refuses an answer that is not JSON', async () => {
    const { fake, provider } = setup();
    fake.failNext({ status: 200, raw: 'no' });
    expect((await providerErrorOf(provider.write('a.json', 'x', null))).kind).toBe('invalid');
  });

  it('reports a full Dropbox as invalid with the detail', async () => {
    const { fake, provider } = setup();
    fake.failNext({
      status: 409,
      body: {
        error_summary: 'path/insufficient_space/..',
        error: { '.tag': 'path', reason: { '.tag': 'insufficient_space' } },
      },
    });
    expect(await providerErrorOf(provider.write('a.json', 'x', null))).toMatchObject({
      kind: 'invalid',
      message: 'Dropbox has no space left.',
      status: 409,
      detail: 'path/insufficient_space/..',
    });
  });

  it('reports a write limit as rate limited', async () => {
    const { fake, provider } = setup();
    fake.failNext({
      status: 409,
      body: { error: { '.tag': 'path', reason: { '.tag': 'too_many_write_operations' } } },
    });
    expect((await providerErrorOf(provider.write('a.json', 'x', null))).kind).toBe('rate-limit');
  });

  it('reports a missing write permission as an auth failure', async () => {
    const { fake, provider } = setup();
    fake.failNext({
      status: 409,
      body: { error: { '.tag': 'path', reason: { '.tag': 'no_write_permission' } } },
    });
    expect((await providerErrorOf(provider.write('a.json', 'x', null))).kind).toBe('auth');
  });

  it('reports another failure of the call as invalid', async () => {
    const { fake, provider } = setup();
    fake.failNext({ status: 409, body: { error: { '.tag': 'path', reason: { '.tag': 'x' } } } });
    expect(await providerErrorOf(provider.write('a.json', 'x', null))).toMatchObject({
      kind: 'invalid',
      message: 'Dropbox answered 409.',
    });
  });

  it('treats a 409 without a readable error as invalid', async () => {
    const { fake, provider } = setup();
    fake.failNext({ status: 409, raw: 'broken' });
    expect((await providerErrorOf(provider.write('a.json', 'x', null))).kind).toBe('invalid');
  });
});

describe('DropboxProvider.remove()', () => {
  it('deletes the file with the revision that was read', async () => {
    const { fake, provider } = setup();
    const rev = fake.put('a.json', 'x');
    await provider.remove('a.json', rev);
    expect(fake.files.has('a.json')).toBe(false);
    expect(fake.requests[0].url).toBe('https://api.dropboxapi.com/2/files/delete_v2');
    expect(fake.requests[0].arg).toEqual({ path: '/a.json', parent_rev: rev });
    expect(fake.requests[0].headers['Content-Type']).toBe('application/json');
  });

  it('does nothing when the file is already gone', async () => {
    const { fake, provider } = setup();
    await provider.remove('a.json', 'rev1');
    expect(fake.requests).toHaveLength(2);
  });

  it('throws a version conflict when the revision no longer matches and Dropbox says not found', async () => {
    const { fake, provider } = setup();
    const rev = fake.put('a.json', 'x');
    fake.put('a.json', 'newer');
    await expect(provider.remove('a.json', rev)).rejects.toBeInstanceOf(VersionConflictError);
    expect(fake.files.get('a.json')?.content).toBe('newer');
  });

  it('throws a version conflict when the revision no longer matches and Dropbox says conflict', async () => {
    const { fake, provider } = setup({ deleteMismatch: 'conflict' });
    const rev = fake.put('a.json', 'x');
    fake.put('a.json', 'newer');
    await expect(provider.remove('a.json', rev)).rejects.toBeInstanceOf(VersionConflictError);
  });

  it('reports another failure of the call as invalid', async () => {
    const { fake, provider } = setup();
    fake.failNext({ status: 409, body: { error: { '.tag': 'path_lookup', x: { '.tag': 'y' } } } });
    expect((await providerErrorOf(provider.remove('a.json', 'rev1'))).kind).toBe('invalid');
  });
});

describe('DropboxProvider errors', () => {
  it('maps 401 to auth with the detail', async () => {
    const { fake, provider } = setup();
    fake.failNext({ status: 401, body: { error_summary: 'invalid_access_token/..' } });
    expect(await providerErrorOf(provider.read('a.json'))).toMatchObject({
      kind: 'auth',
      status: 401,
      detail: 'invalid_access_token/..',
    });
  });

  it('maps a plain text 401 to auth with no detail', async () => {
    const error = await providerErrorOf(
      new DropboxProvider({ getToken: async () => 'wrong', fetch: setup().fake.fetch }).read(
        'a.json',
      ),
    );
    expect(error).toMatchObject({ kind: 'auth', status: 401 });
    expect(error.detail).toBeUndefined();
  });

  it('maps 403 to auth', async () => {
    const { fake, provider } = setup();
    fake.failNext({ status: 403, body: { error_summary: 'missing_scope/..' } });
    expect(await providerErrorOf(provider.read('a.json'))).toMatchObject({
      kind: 'auth',
      status: 403,
      message: 'The token has no permission for Dropbox.',
    });
  });

  it('maps 429 to rate-limit with the Retry-After header', async () => {
    const { fake, provider } = setup();
    fake.failNext({ status: 429, headers: { 'retry-after': '30' } });
    expect(await providerErrorOf(provider.read('a.json'))).toMatchObject({
      kind: 'rate-limit',
      status: 429,
      retryAfterSeconds: 30,
    });
  });

  it('maps 429 to rate-limit with the seconds of the body', async () => {
    const { fake, provider } = setup();
    fake.failNext({ status: 429, body: { error: { retry_after: 300 } } });
    expect((await providerErrorOf(provider.read('a.json'))).retryAfterSeconds).toBe(300);
  });

  it('maps 429 to rate-limit with no seconds when none are given', async () => {
    const { fake, provider } = setup();
    fake.failNext({ status: 429, body: { error: {} } });
    expect((await providerErrorOf(provider.read('a.json'))).retryAfterSeconds).toBeUndefined();
  });

  it('maps 429 with a header that is not a number to no seconds', async () => {
    const { fake, provider } = setup();
    fake.failNext({ status: 429, headers: { 'retry-after': 'soon' }, raw: 'slow down' });
    expect((await providerErrorOf(provider.read('a.json'))).retryAfterSeconds).toBeUndefined();
  });

  it('maps 5xx to server', async () => {
    const { fake, provider } = setup();
    fake.failNext({ status: 503, body: {} });
    expect(await providerErrorOf(provider.read('a.json'))).toMatchObject({
      kind: 'server',
      status: 503,
    });
  });

  it('maps another status to invalid', async () => {
    const { fake, provider } = setup();
    fake.failNext({ status: 400, raw: 'Error in call to API function' });
    expect(await providerErrorOf(provider.read('a.json'))).toMatchObject({
      kind: 'invalid',
      message: 'Dropbox answered 400.',
    });
  });

  it('maps a failed request to network', async () => {
    const { fake, provider } = setup();
    fake.goOffline();
    expect((await providerErrorOf(provider.read('a.json'))).kind).toBe('network');
  });

  it('uses the global fetch when none is given', async () => {
    const fake = createFakeDropbox();
    const original = globalThis.fetch;
    globalThis.fetch = fake.fetch;
    try {
      const provider = new DropboxProvider({ getToken: async () => fake.token });
      expect(await provider.read('a.json')).toBeNull();
    } finally {
      globalThis.fetch = original;
    }
  });
});
