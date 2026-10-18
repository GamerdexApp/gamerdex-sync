import { GOOGLE_DRIVE_SCOPE, googleAuthorizeUrl } from '@/auth/google';

describe('googleAuthorizeUrl()', () => {
  it('asks for a code, the Drive file scope and a refresh token', () => {
    const url = new URL(googleAuthorizeUrl('client-1', 'https://site.test/sync/callback', 's 1'));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'client-1',
      redirect_uri: 'https://site.test/sync/callback',
      response_type: 'code',
      scope: GOOGLE_DRIVE_SCOPE,
      access_type: 'offline',
      prompt: 'consent',
      state: 's 1',
    });
  });

  it('asks for the narrow scope only', () => {
    expect(GOOGLE_DRIVE_SCOPE).toBe('https://www.googleapis.com/auth/drive.file');
  });
});
