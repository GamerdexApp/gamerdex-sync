import { parseTokenResponse, toStoredTokens } from '@/auth/tokens';

const good = { accessToken: 'a', expiresIn: 28800, refreshToken: 'r', refreshExpiresIn: 15552000 };

describe('parseTokenResponse()', () => {
  it('accepts a whole answer', () => {
    expect(parseTokenResponse(good)).toEqual(good);
  });

  it('refuses an answer that is not whole', () => {
    expect(parseTokenResponse(null)).toBeNull();
    expect(parseTokenResponse([good])).toBeNull();
    expect(parseTokenResponse({ ...good, accessToken: '' })).toBeNull();
    expect(parseTokenResponse({ ...good, accessToken: 5 })).toBeNull();
    expect(parseTokenResponse({ ...good, refreshToken: '' })).toBeNull();
    expect(parseTokenResponse({ ...good, expiresIn: 0 })).toBeNull();
    expect(parseTokenResponse({ ...good, expiresIn: '5' })).toBeNull();
    expect(parseTokenResponse({ ...good, refreshExpiresIn: Infinity })).toBeNull();
  });
});

describe('toStoredTokens()', () => {
  it('turns lifetimes in seconds into times in milliseconds', () => {
    expect(toStoredTokens(good, 1_000)).toEqual({
      accessToken: 'a',
      accessExpiresAt: 1_000 + 28_800_000,
      refreshToken: 'r',
      refreshExpiresAt: 1_000 + 15_552_000_000,
    });
  });
});
