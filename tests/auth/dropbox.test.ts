import { DROPBOX_SCOPES, dropboxAuthorizeUrl } from '@/auth/dropbox';

describe('dropboxAuthorizeUrl()', () => {
  it('asks for a code, the two file scopes and a refresh token', () => {
    const url = new URL(dropboxAuthorizeUrl('key-1', 'https://site.test/sync/callback', 's 1'));
    expect(url.origin + url.pathname).toBe('https://www.dropbox.com/oauth2/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'key-1',
      redirect_uri: 'https://site.test/sync/callback',
      response_type: 'code',
      token_access_type: 'offline',
      scope: 'files.content.read files.content.write',
      state: 's 1',
    });
  });

  it('asks for the two content scopes only', () => {
    expect(DROPBOX_SCOPES).toEqual(['files.content.read', 'files.content.write']);
  });
});
