import { createTokenSource } from '@/auth/source';
import { StoredTokens } from '@/auth/tokens';
import { ProviderError } from '@/provider/types';

const answer = (access: string, refresh = 'r2') =>
  new Response(
    JSON.stringify({
      accessToken: access,
      expiresIn: 28800,
      refreshToken: refresh,
      refreshExpiresIn: 15552000,
    }),
  );

const setup = (
  tokens: StoredTokens | null,
  respond: () => Response | Promise<Response> = () => answer('fresh'),
) => {
  let stored = tokens;
  let now = 1_000_000;
  const calls: { url: string; body: unknown }[] = [];
  const fetchStub = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    return respond();
  }) as unknown as typeof fetch;
  const source = createTokenSource({
    endpoint: 'https://auth.test',
    load: () => stored,
    save: (next) => {
      stored = next;
    },
    now: () => now,
    fetch: fetchStub,
  });
  return {
    source,
    calls,
    stored: () => stored,
    advance: (ms: number) => {
      now += ms;
    },
  };
};

const valid: StoredTokens = {
  accessToken: 'live',
  accessExpiresAt: 1_000_000 + 3_600_000,
  refreshToken: 'r1',
  refreshExpiresAt: 1_000_000 + 86_400_000,
};

const failure = async (action: Promise<unknown>) => {
  const error = await action.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ProviderError);
  return error as ProviderError;
};

describe('createTokenSource()', () => {
  it('returns the saved token while it is valid for more than a minute', async () => {
    const { source, calls } = setup(valid);
    expect(await source.getToken()).toBe('live');
    expect(calls).toEqual([]);
  });

  it('is signed out without tokens and refuses to give a token', async () => {
    const { source } = setup(null);
    expect(source.isSignedIn()).toBe(false);
    expect((await failure(source.getToken())).kind).toBe('auth');
  });

  it('renews a token that ends within a minute and saves the new tokens', async () => {
    const { source, calls, stored } = setup({ ...valid, accessExpiresAt: 1_000_000 + 30_000 });
    expect(await source.getToken()).toBe('fresh');
    expect(calls).toEqual([{ url: 'https://auth.test/refresh', body: { refreshToken: 'r1' } }]);
    expect(stored()).toMatchObject({ accessToken: 'fresh', refreshToken: 'r2' });
  });

  it('renews once when several calls ask at the same time', async () => {
    const { source, calls } = setup({ ...valid, accessExpiresAt: 0 });
    const tokens = await Promise.all([source.getToken(), source.getToken(), source.getToken()]);
    expect(tokens).toEqual(['fresh', 'fresh', 'fresh']);
    expect(calls).toHaveLength(1);
  });

  it('renews again later after an earlier renewal finished', async () => {
    const { source, calls, advance } = setup({ ...valid, accessExpiresAt: 0 });
    await source.getToken();
    advance(28_800_000);
    await source.getToken();
    expect(calls).toHaveLength(2);
  });

  it('signs the player out when the refresh token ran out', async () => {
    const { source, calls, stored } = setup({
      ...valid,
      accessExpiresAt: 0,
      refreshExpiresAt: 500,
    });
    expect((await failure(source.getToken())).kind).toBe('auth');
    expect(stored()).toBeNull();
    expect(calls).toEqual([]);
  });

  it('signs the player out when GitHub refuses the refresh token', async () => {
    const { source, stored } = setup(
      { ...valid, accessExpiresAt: 0 },
      () => new Response('{}', { status: 400 }),
    );
    expect((await failure(source.getToken())).kind).toBe('auth');
    expect(stored()).toBeNull();
  });

  it('stays signed in when the service is down or offline', async () => {
    const down = setup({ ...valid, accessExpiresAt: 0 }, () => new Response('', { status: 503 }));
    expect((await failure(down.source.getToken())).kind).toBe('server');
    expect(down.stored()).not.toBeNull();

    const offline = setup({ ...valid, accessExpiresAt: 0 }, () => {
      throw new TypeError('offline');
    });
    expect((await failure(offline.source.getToken())).kind).toBe('network');
    expect(offline.stored()).not.toBeNull();
  });

  it('refuses an answer that is not JSON or not whole', async () => {
    const bad = setup({ ...valid, accessExpiresAt: 0 }, () => new Response('not json'));
    expect((await failure(bad.source.getToken())).kind).toBe('auth');
    const thin = setup({ ...valid, accessExpiresAt: 0 }, () => new Response('{"accessToken":"x"}'));
    expect((await failure(thin.source.getToken())).kind).toBe('auth');
  });

  it('signs in with a code, saves the tokens and signs out', async () => {
    const { source, calls, stored } = setup(null, () => answer('first', 'r9'));
    const tokens = await source.signIn('code1', 'https://x.test/cb');
    expect(calls).toEqual([
      { url: 'https://auth.test/token', body: { code: 'code1', redirectUri: 'https://x.test/cb' } },
    ]);
    expect(tokens).toMatchObject({ accessToken: 'first', refreshToken: 'r9' });
    expect(stored()).toEqual(tokens);
    expect(source.isSignedIn()).toBe(true);
    source.signOut();
    expect(stored()).toBeNull();
  });

  it('uses the global fetch when none is given', async () => {
    const spy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(answer('g'));
    let saved: StoredTokens | null = null;
    const source = createTokenSource({
      endpoint: 'https://auth.test',
      load: () => saved,
      save: (next) => {
        saved = next;
      },
      now: () => 0,
    });
    await source.signIn('c', 'r');
    expect(saved).toMatchObject({ accessToken: 'g' });
    spy.mockRestore();
  });
});
