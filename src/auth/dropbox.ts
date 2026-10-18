/** The scopes that sync asks for. Together with the App folder access type, they reach one folder. */
export const DROPBOX_SCOPES = ['files.content.read', 'files.content.write'] as const;

/**
 * The address of the Dropbox sign in page. `token_access_type=offline` makes Dropbox send a
 * refresh token, which does not expire until the player removes the access.
 */
export const dropboxAuthorizeUrl = (
  clientId: string,
  redirectUri: string,
  state: string,
): string => {
  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    token_access_type: 'offline',
    scope: DROPBOX_SCOPES.join(' '),
    state,
  });
  return `https://www.dropbox.com/oauth2/authorize?${query}`;
};
