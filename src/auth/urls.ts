import { GITHUB_APP } from './app';

/** A random value that ties a sign-in answer to the sign-in that this device started. */
export const newState = (): string => crypto.randomUUID();

export const authorizeUrl = (redirectUri: string, state: string): string => {
  const query = new URLSearchParams({
    client_id: GITHUB_APP.clientId,
    redirect_uri: redirectUri,
    state,
  });
  return `https://github.com/login/oauth/authorize?${query}`;
};

/** The page where the player picks the repository that the app may use. */
export const installUrl = (state: string): string =>
  `https://github.com/apps/${GITHUB_APP.slug}/installations/new?${new URLSearchParams({ state })}`;

export type CallbackResult =
  { ok: true; code: string } | { ok: false; reason: 'denied' | 'state' | 'missing' };

/**
 * Reads the query of the sign-in callback page. The state must equal the state that was saved when
 * the sign-in started, or the answer is refused.
 */
export const readCallback = (search: string, expectedState: string | null): CallbackResult => {
  const query = new URLSearchParams(search);
  if (query.get('error') !== null) return { ok: false, reason: 'denied' };
  const code = query.get('code');
  if (code === null || code === '') return { ok: false, reason: 'missing' };
  if (expectedState === null || query.get('state') !== expectedState) {
    return { ok: false, reason: 'state' };
  }
  return { ok: true, code };
};
