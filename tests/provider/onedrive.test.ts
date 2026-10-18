import { OneDriveProvider } from '@/provider/onedrive';
import { ProviderError, VersionConflictError } from '@/provider/types';
import { createFakeOneDrive } from './fakeOneDrive';

const setup = (options: Parameters<typeof createFakeOneDrive>[0] = {}) => {
  const fake = createFakeOneDrive(options);
  const getToken = jest.fn(async () => fake.token);
  const provider = new OneDriveProvider({ getToken, fetch: fake.fetch });
  return { fake, provider, getToken };
};

const providerErrorOf = async (action: Promise<unknown>) => {
  const error = await action.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ProviderError);
  return error as ProviderError;
};

const APP_FOLDER = 'https://graph.microsoft.com/v1.0/me/drive/special/approot:';

describe('OneDriveProvider.read()', () => {
  it('returns null for a file that does not exist', async () => {
    expect(await setup().provider.read('Gamerdex/app/data.json')).toBeNull();
  });

  it('returns the content and the eTag as the version', async () => {
    const { fake, provider } = setup();
    const eTag = fake.put('Gamerdex/app/data.json', '{"name":"Ünï 🙂"}');
    expect(await provider.read('Gamerdex/app/data.json')).toEqual({
      content: '{"name":"Ünï 🙂"}',
      version: eTag,
    });
  });

  it('asks for the file in the app folder and sends no token to the download address', async () => {
    const { fake, provider, getToken } = setup();
    const eTag = fake.put('Gamerdex/my app/data.json', 'x');
    await provider.read('Gamerdex/my app/data.json');
    expect(fake.requests[0].method).toBe('GET');
    expect(fake.requests[0].url).toBe(`${APP_FOLDER}/Gamerdex/my%20app/data.json`);
    expect(fake.requests[0].headers.Authorization).toBe('Bearer token-1');
    expect(fake.requests[1].url).toBe('https://download.test/Gamerdex%2Fmy%20app%2Fdata.json');
    expect(fake.requests[1].headers).toEqual({});
    expect(getToken).toHaveBeenCalledTimes(1);
    expect(eTag).toBe('etag1');
  });

  it('returns null when the file is removed between the two requests', async () => {
    const { fake } = setup();
    fake.put('a.json', 'x');
    fake.files.set('a.json', { content: 'x', eTag: 'etag1' });
    const original = fake.fetch;
    let calls = 0;
    const racing = new OneDriveProvider({
      getToken: async () => fake.token,
      fetch: (async (...args: Parameters<typeof fetch>) => {
        calls += 1;
        const answer = await original(...args);
        if (calls === 1) fake.files.delete('a.json');
        return answer;
      }) as typeof fetch,
    });
    expect(await racing.read('a.json')).toBeNull();
  });

  it('refuses an answer without a version', async () => {
    const { fake, provider } = setup();
    fake.failNext({ status: 200, body: {} });
    expect(await providerErrorOf(provider.read('a.json'))).toMatchObject({
      kind: 'invalid',
      message: 'The file has no version.',
    });
  });

  it('refuses an answer that is not JSON', async () => {
    const { fake, provider } = setup();
    fake.failNext({ status: 200, raw: 'no' });
    expect((await providerErrorOf(provider.read('a.json'))).kind).toBe('invalid');
  });

  it('refuses an answer without a download address', async () => {
    const { fake, provider } = setup();
    fake.failNext({ status: 200, body: { eTag: 'e1' } });
    expect(await providerErrorOf(provider.read('a.json'))).toMatchObject({
      kind: 'invalid',
      message: 'The file has no download address.',
    });
  });

  it('maps a failed download to its error', async () => {
    const { fake } = setup();
    fake.put('a.json', 'x');
    const original = fake.fetch;
    let calls = 0;
    const failing = new OneDriveProvider({
      getToken: async () => fake.token,
      fetch: (async (...args: Parameters<typeof fetch>) => {
        calls += 1;
        return calls === 2 ? new Response('', { status: 500 }) : original(...args);
      }) as typeof fetch,
    });
    expect((await providerErrorOf(failing.read('a.json'))).kind).toBe('server');
  });

  it('maps an unreachable download address to network', async () => {
    const { fake } = setup();
    fake.put('a.json', 'x');
    const original = fake.fetch;
    let calls = 0;
    const offline = new OneDriveProvider({
      getToken: async () => fake.token,
      fetch: (async (...args: Parameters<typeof fetch>) => {
        calls += 1;
        if (calls === 2) throw new TypeError('Failed to fetch');
        return original(...args);
      }) as typeof fetch,
    });
    expect((await providerErrorOf(offline.read('a.json'))).kind).toBe('network');
  });
});

describe('OneDriveProvider.write()', () => {
  it('creates a file that must not exist and returns the eTag', async () => {
    const { fake, provider } = setup();
    expect(await provider.write('Gamerdex/app/data.json', '{"a":1}', null)).toEqual({
      version: 'etag1',
    });
    expect(fake.files.get('Gamerdex/app/data.json')).toEqual({
      content: '{"a":1}',
      eTag: 'etag1',
    });
    expect(fake.requests[0].method).toBe('PUT');
    expect(fake.requests[0].url).toBe(
      `${APP_FOLDER}/Gamerdex/app/data.json:/content?@microsoft.graph.conflictBehavior=fail`,
    );
    expect(fake.requests[0].headers['If-Match']).toBeUndefined();
    expect(fake.requests[0].headers['Content-Type']).toBe('text/plain');
  });

  it('updates a file with the eTag that was read', async () => {
    const { fake, provider } = setup();
    const eTag = fake.put('a.json', 'old');
    expect(await provider.write('a.json', 'new', eTag)).toEqual({ version: 'etag2' });
    expect(fake.files.get('a.json')?.content).toBe('new');
    expect(fake.requests[0].url).toBe(`${APP_FOLDER}/a.json:/content`);
    expect(fake.requests[0].headers['If-Match']).toBe(eTag);
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
    const eTag = fake.put('a.json', 'old');
    fake.put('a.json', 'other device');
    await expect(provider.write('a.json', 'mine', eTag)).rejects.toBeInstanceOf(
      VersionConflictError,
    );
    expect(fake.files.get('a.json')?.content).toBe('other device');
  });

  it.each([412, 404] as const)(
    'throws a version conflict when the file was removed and OneDrive answers %i',
    async (status) => {
      const { fake, provider } = setup({ missingWithIfMatch: status });
      await expect(provider.write('a.json', 'mine', 'etag9')).rejects.toBeInstanceOf(
        VersionConflictError,
      );
      expect(fake.files.size).toBe(0);
    },
  );

  it('removes the file that OneDrive created for a write that expected a removed file', async () => {
    const { fake, provider } = setup({ missingWithIfMatch: 201 });
    await expect(provider.write('a.json', 'mine', 'etag9')).rejects.toBeInstanceOf(
      VersionConflictError,
    );
    expect(fake.files.size).toBe(0);
    expect(fake.requests.map((request) => request.method)).toEqual(['PUT', 'DELETE']);
    expect(fake.requests[1].headers['If-Match']).toBe('etag1');
  });

  it('keeps going when another device changed the file that OneDrive created', async () => {
    const { fake } = setup({ missingWithIfMatch: 201 });
    const original = fake.fetch;
    let calls = 0;
    const racing = new OneDriveProvider({
      getToken: async () => fake.token,
      fetch: (async (...args: Parameters<typeof fetch>) => {
        calls += 1;
        if (calls === 2) fake.put('a.json', 'other device');
        return original(...args);
      }) as typeof fetch,
    });
    await expect(racing.write('a.json', 'mine', 'etag9')).rejects.toBeInstanceOf(
      VersionConflictError,
    );
    expect(fake.files.get('a.json')?.content).toBe('other device');
  });

  it('reports a failed removal of the file that OneDrive created', async () => {
    const { fake } = setup({ missingWithIfMatch: 201 });
    const original = fake.fetch;
    let calls = 0;
    const failing = new OneDriveProvider({
      getToken: async () => fake.token,
      fetch: (async (...args: Parameters<typeof fetch>) => {
        calls += 1;
        return calls === 2 ? new Response('', { status: 500 }) : original(...args);
      }) as typeof fetch,
    });
    expect((await providerErrorOf(failing.write('a.json', 'mine', 'etag9'))).kind).toBe('server');
  });

  it('still reports a conflict when the created file has no eTag to remove', async () => {
    const { fake, provider } = setup();
    fake.failNext({ status: 201, body: {} });
    await expect(provider.write('a.json', 'mine', 'etag9')).rejects.toBeInstanceOf(
      VersionConflictError,
    );
    expect(fake.requests).toHaveLength(1);
  });

  it('refuses an answer without an eTag', async () => {
    const { fake, provider } = setup();
    fake.failNext({ status: 201, body: {} });
    expect(await providerErrorOf(provider.write('a.json', 'x', null))).toMatchObject({
      kind: 'invalid',
      message: 'The write returned no version.',
    });
  });

  it('refuses an answer that is not JSON', async () => {
    const { fake, provider } = setup();
    fake.failNext({ status: 201, raw: 'no' });
    expect((await providerErrorOf(provider.write('a.json', 'x', null))).kind).toBe('invalid');
  });
});

describe('OneDriveProvider.remove()', () => {
  it('deletes the file with the eTag that was read', async () => {
    const { fake, provider } = setup();
    const eTag = fake.put('a.json', 'x');
    await provider.remove('a.json', eTag);
    expect(fake.files.has('a.json')).toBe(false);
    expect(fake.requests[0].method).toBe('DELETE');
    expect(fake.requests[0].headers['If-Match']).toBe(eTag);
  });

  it('does nothing when the file is already gone', async () => {
    await setup().provider.remove('a.json', 'etag1');
  });

  it('throws a version conflict when the file changed since it was read', async () => {
    const { fake, provider } = setup();
    const eTag = fake.put('a.json', 'x');
    fake.put('a.json', 'newer');
    await expect(provider.remove('a.json', eTag)).rejects.toBeInstanceOf(VersionConflictError);
    expect(fake.files.get('a.json')?.content).toBe('newer');
  });
});

describe('OneDriveProvider errors', () => {
  it('maps 401 to auth with the detail', async () => {
    const error = await providerErrorOf(
      new OneDriveProvider({
        getToken: async () => 'wrong',
        fetch: setup().fake.fetch,
      }).read('a.json'),
    );
    expect(error).toMatchObject({
      kind: 'auth',
      status: 401,
      detail: 'InvalidAuthenticationToken message',
    });
  });

  it('maps 403 to auth', async () => {
    const { fake, provider } = setup();
    fake.failNext({ status: 403, body: { error: { message: 'Access denied' } } });
    expect(await providerErrorOf(provider.read('a.json'))).toMatchObject({
      kind: 'auth',
      status: 403,
      message: 'The token has no permission for OneDrive.',
      detail: 'Access denied',
    });
  });

  it('maps 429 to rate-limit with the Retry-After header', async () => {
    const { fake, provider } = setup();
    fake.failNext({ status: 429, headers: { 'retry-after': '10' } });
    expect(await providerErrorOf(provider.read('a.json'))).toMatchObject({
      kind: 'rate-limit',
      status: 429,
      retryAfterSeconds: 10,
    });
  });

  it('maps 429 with no usable Retry-After to no seconds', async () => {
    const { fake, provider } = setup();
    fake.failNext({ status: 429, headers: { 'retry-after': 'soon' } });
    expect((await providerErrorOf(provider.read('a.json'))).retryAfterSeconds).toBeUndefined();
  });

  it('maps 503 with Retry-After to rate-limit', async () => {
    const { fake, provider } = setup();
    fake.failNext({ status: 503, headers: { 'retry-after': '5' } });
    expect(await providerErrorOf(provider.read('a.json'))).toMatchObject({
      kind: 'rate-limit',
      retryAfterSeconds: 5,
    });
  });

  it('maps 5xx without Retry-After to server', async () => {
    const { fake, provider } = setup();
    fake.failNext({ status: 503, body: {} });
    expect(await providerErrorOf(provider.read('a.json'))).toMatchObject({
      kind: 'server',
      status: 503,
    });
  });

  it('maps a 404 that is not a missing file to not-found', async () => {
    const { fake } = setup();
    fake.failNext({
      status: 200,
      body: { eTag: 'e1', '@microsoft.graph.downloadUrl': 'https://x.test/a' },
    });
    const original = fake.fetch;
    const missing = new OneDriveProvider({
      getToken: async () => fake.token,
      fetch: (async (url: string, init?: RequestInit) =>
        init?.method === 'PUT'
          ? new Response(JSON.stringify({ error: { message: 'No app folder' } }), { status: 404 })
          : original(url, init)) as typeof fetch,
    });
    expect(await providerErrorOf(missing.write('a.json', 'x', null))).toMatchObject({
      kind: 'not-found',
      status: 404,
      detail: 'No app folder',
    });
  });

  it('maps another status to invalid', async () => {
    const { fake, provider } = setup();
    fake.failNext({ status: 400, raw: 'bad' });
    expect(await providerErrorOf(provider.read('a.json'))).toMatchObject({
      kind: 'invalid',
      message: 'OneDrive answered 400.',
    });
  });

  it('maps a failed request to network', async () => {
    const { fake, provider } = setup();
    fake.goOffline();
    expect((await providerErrorOf(provider.read('a.json'))).kind).toBe('network');
  });

  it('uses the global fetch when none is given', async () => {
    const fake = createFakeOneDrive();
    const original = globalThis.fetch;
    globalThis.fetch = fake.fetch;
    try {
      const provider = new OneDriveProvider({ getToken: async () => fake.token });
      expect(await provider.read('a.json')).toBeNull();
    } finally {
      globalThis.fetch = original;
    }
  });
});
