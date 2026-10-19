/** The public values of the Gamerdex Sync GitHub App. The client secret is never kept here. */
export const GITHUB_APP = {
  slug: 'gamerdex-sync',
  clientId: 'Iv23liwzjj3x8O2K5ALA',
} as const;

/**
 * The public client IDs of the Gamerdex Sync apps at Google, Dropbox and Microsoft. An app uses
 * them unless it sets its own. A client ID is in every sign in address, and the client secrets
 * stay in `gamerdex-auth`.
 */
export const CLIENT_IDS = {
  google: '365484687434-nudmngiidpmtn7bol8b2hj33l9ogh37d.apps.googleusercontent.com',
  dropbox: 'hs0nd0t45uquupv',
  microsoft: 'ea7ec780-ebfa-42ff-8fd2-a6209d582c57',
} as const;
