/** The tokens of a signed in player. Times are milliseconds since 1970. */
export interface StoredTokens {
  accessToken: string;
  accessExpiresAt: number;
  refreshToken: string;
  refreshExpiresAt: number;
}

/** The answer of the token function, with lifetimes in seconds. */
export interface TokenResponse {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresIn: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isSeconds = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

export const parseTokenResponse = (body: unknown): TokenResponse | null => {
  if (!isRecord(body)) return null;
  const { accessToken, expiresIn, refreshToken, refreshExpiresIn } = body;
  if (typeof accessToken !== 'string' || accessToken === '') return null;
  if (typeof refreshToken !== 'string' || refreshToken === '') return null;
  if (!isSeconds(expiresIn) || !isSeconds(refreshExpiresIn)) return null;
  return { accessToken, expiresIn, refreshToken, refreshExpiresIn };
};

export const toStoredTokens = (response: TokenResponse, nowMs: number): StoredTokens => ({
  accessToken: response.accessToken,
  accessExpiresAt: nowMs + response.expiresIn * 1000,
  refreshToken: response.refreshToken,
  refreshExpiresAt: nowMs + response.refreshExpiresIn * 1000,
});
