import { ProviderError } from '../provider/types';
import { parseTokenResponse, StoredTokens, toStoredTokens } from './tokens';

const RENEW_BEFORE_MS = 60_000;

export interface TokenSourceOptions {
  /** The address of the token function, without a trailing slash. */
  endpoint: string;
  /** Reads the tokens that this device saved, or null when the player is signed out. */
  load: () => StoredTokens | null;
  /** Saves the tokens, or removes them when null. */
  save: (tokens: StoredTokens | null) => void;
  now: () => number;
  fetch?: typeof fetch;
}

/**
 * Keeps a player signed in. `getToken` returns a token that is valid for at least a minute and
 * renews it first when needed. It is meant to be the `getToken` of `GitHubProvider`.
 */
export const createTokenSource = (options: TokenSourceOptions) => {
  const send = options.fetch ?? ((...args) => globalThis.fetch(...args));
  let renewing: Promise<StoredTokens> | null = null;

  const post = async (path: string, body: Record<string, string>): Promise<StoredTokens> => {
    let response: Response;
    try {
      response = await send(`${options.endpoint}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      throw new ProviderError('network', 'The sign in service could not be reached.');
    }
    if (response.status >= 500) throw new ProviderError('server', 'The sign in service failed.');
    const parsed = response.ok ? parseTokenResponse(await response.json().catch(() => null)) : null;
    if (parsed === null)
      throw new ProviderError('auth', 'The sign in was refused.', response.status);
    const tokens = toStoredTokens(parsed, options.now());
    options.save(tokens);
    return tokens;
  };

  const renew = (tokens: StoredTokens): Promise<StoredTokens> => {
    if (tokens.refreshExpiresAt <= options.now()) {
      options.save(null);
      throw new ProviderError('auth', 'The sign in expired.');
    }
    renewing ??= post('refresh', { refreshToken: tokens.refreshToken })
      .catch((error: unknown) => {
        if (error instanceof ProviderError && error.kind === 'auth') options.save(null);
        throw error;
      })
      .finally(() => {
        renewing = null;
      });
    return renewing;
  };

  return {
    /** Finishes a sign in with the code from the callback page. */
    signIn: (code: string, redirectUri: string): Promise<StoredTokens> =>
      post('token', { code, redirectUri }),
    signOut: (): void => options.save(null),
    isSignedIn: (): boolean => options.load() !== null,
    getToken: async (): Promise<string> => {
      const tokens = options.load();
      if (tokens === null) throw new ProviderError('auth', 'The player is not signed in.');
      if (tokens.accessExpiresAt - RENEW_BEFORE_MS > options.now()) return tokens.accessToken;
      return (await renew(tokens)).accessToken;
    },
  };
};
