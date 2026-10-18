import { GITHUB_APP } from '@/auth/app';
import { authorizeUrl, installUrl, newState, readCallback } from '@/auth/urls';

describe('urls', () => {
  it('builds the sign in address with the client id, the callback and the state', () => {
    const url = new URL(authorizeUrl('https://site.test/sync/callback', 'abc'));
    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe(GITHUB_APP.clientId);
    expect(url.searchParams.get('redirect_uri')).toBe('https://site.test/sync/callback');
    expect(url.searchParams.get('state')).toBe('abc');
  });

  it('builds the install address from the slug', () => {
    expect(installUrl('s 1')).toBe(
      'https://github.com/apps/gamerdex-sync/installations/new?state=s+1',
    );
  });

  it('makes a different state each time', () => {
    expect(newState()).not.toBe(newState());
    expect(newState()).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('readCallback()', () => {
  it('returns the code when the state matches', () => {
    expect(readCallback('?code=c1&state=s1', 's1')).toEqual({ ok: true, code: 'c1' });
  });

  it('refuses a different state or no saved state', () => {
    expect(readCallback('?code=c1&state=other', 's1')).toEqual({ ok: false, reason: 'state' });
    expect(readCallback('?code=c1', 's1')).toEqual({ ok: false, reason: 'state' });
    expect(readCallback('?code=c1&state=s1', null)).toEqual({ ok: false, reason: 'state' });
  });

  it('reports a denied sign in and a missing code', () => {
    expect(readCallback('?error=access_denied&state=s1', 's1')).toEqual({
      ok: false,
      reason: 'denied',
    });
    expect(readCallback('?state=s1', 's1')).toEqual({ ok: false, reason: 'missing' });
    expect(readCallback('?code=&state=s1', 's1')).toEqual({ ok: false, reason: 'missing' });
  });
});
