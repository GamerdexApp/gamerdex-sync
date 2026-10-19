# Design

## Goals

- One sync for every Gamerdex app. A fix is made here once, and each app updates its version.
- The player's data lives in the player's own GitHub repository. No Gamerdex server holds game data.
- Several devices can change the same data. The result never loses a change without telling the
  player.
- The app keeps working with no account. Export and import stay.

## Decisions

| Topic          | Decision                                                                                                                                                                                                                                 |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider       | GitHub first. A private repository that the player owns. Google Drive, Dropbox and OneDrive sit behind the same interface.                                                                                                               |
| Folder         | `Gamerdex/<app id>/` in the repository, so every app shares one visible folder.                                                                                                                                                          |
| Files          | `data.json` and `meta.json`. See the README.                                                                                                                                                                                             |
| Data format    | The saved data of the app, in the same shape as its backup file. The active chief and the sign in are device values and never sync.                                                                                                      |
| Sign in        | GitHub sign in through a GitHub App that is installed on the one data repository. A plain OAuth app needs the `repo` scope, which opens every private repository of the player.                                                          |
| Token exchange | GitHub does not allow the token calls from a browser, so one small stateless function shared by all apps exchanges and refreshes the token. It never sees game data.                                                                     |
| Merge          | Full three way merge against the last synced copy. A revision counter in the meta file settles the rest. Clocks are never used.                                                                                                          |
| Package        | Public and open source as `@gamerdexapp/gamerdex-sync`. The apps are public and the deployed code is visible to every visitor, so the protection of the player's data rests on the token and its permissions, never on hiding this code. |

## Layers

1. Layout and meta (built): the paths and the bookkeeping file.
2. Merge engine: `merge({ base, local, remote, schema })` returns the merged data and the list of
   conflicts. A schema names a strategy for each path of the data.
3. Provider interface: `read`, `write` with an expected version and `remove`. A write with an old
   version fails with a conflict error, which is what makes two devices safe.
4. GitHub provider: the contents API with the file `sha` as the version.
5. Sync flow: pull, merge, push, with retry on a version conflict, offline handling and the first
   sync rules.
6. Sign in: the GitHub App flow and the token function.
7. App integration: the Settings tab, the header chip, the conflict screen, Reset with the synced
   copy and the translations. This part lives in each app.

## Merge strategies

| Strategy | Use                                                                                                           |
| -------- | ------------------------------------------------------------------------------------------------------------- |
| `record` | A value that cannot merge. If only one side changed it, that side wins. If both changed it, it is a conflict. |
| `max`    | A level. When both sides changed it, the higher one wins, by the game order and never by text.                |
| `join`   | A list of plain values. The result is the union, and a value removed since the last sync stays removed.       |
| `local`  | A value of this device, such as the active chief. The cloud value is ignored.                                 |
| `object` | A map of entries. Each entry merges with its own strategy.                                                    |
| `keyed`  | A list of objects with an id, such as the chiefs. Its entries merge like the entries of an `object`.          |

`deleteWins` on an `object` or a `keyed` list makes a removal win over a change of the other side
below it. The app sets it on the data of a chief, so a reset wins over a higher level, and leaves it
off the list of chiefs.

A part that only one side changed takes that change, whatever the strategy. A conflict never loses
data: the merged data holds the value of the preferred side, and `resolveConflict` lets the player
pick the other side. When a chief is removed on one device and changed on the other, the changed
chief stays whichever side is preferred, and the conflict asks the player. Nothing is removed before
the player decides.

## Provider notes

- A file version is the `sha` that GitHub gives the file. A write sends the `sha` that was read.
  GitHub answers 409 when the file changed since and 422 when a file that exists is created again,
  and both become `VersionConflictError`.
- `getToken` is called for every request, so a token that expires can refresh first.
- `checkRepository()` refuses a public repository and a token that cannot write. The saved data must
  never sit in a public repository.
- `ProviderError.detail` holds the `message` that GitHub sent with the failure, cut to 300
  characters. It is for logs and support. It is English text from GitHub and is not translated.
- Errors have a kind (`auth`, `rate-limit`, `not-found`, `network`, `server`, `invalid`) so the app
  can say what to do. `rate-limit` carries the seconds to wait when GitHub says so.
- The GitHub behaviors above were written from the GitHub documentation and are tested against a
  fake of the API. They still need one check against the real API with a private test repository.

## Sync flow notes

- `sync()` is a function of its inputs. It does not store anything. The app keeps the returned
  `state` (the cloud data as last seen, plus the file versions) next to the saved data, outside it.
- A value with the `local` strategy stays on the device. The merge returns `merged` for the device
  and `cloud` for the cloud, and `cloud` keeps the cloud value for those parts.
- On the first sync, when both sides hold different data, `sync()` returns `needs-choice`. The app
  asks the player and calls again with `firstSync` set to `merge`, `keep-local` or `keep-cloud`.
- A write refused with `VersionConflictError` makes `sync()` read and merge again, up to four times,
  then throw `SyncBusyError`. The data file is written before the meta file. A failed meta write
  does not undo the data write, and the next sync repairs it.
- A sync that changes nothing writes no file. The meta file is written when data was uploaded, when
  this device is not yet recorded in it, and when the app passes `updateMeta`. `lastSeenAt` of a
  device is therefore the time of its last upload or its first sync, not of its last check.
- The cloud data and the merged data must pass the app `validate` before any write. A failure throws
  `RemoteDataError` and nothing is written.

## Sign in notes

- The app is a GitHub App named `gamerdex-sync` (public values in `src/auth/app.ts`). It has only
  the Contents read and write permission, and a player installs it on one private repository.
- The token function lives in the `gamerdex-auth` project, not in this package. It holds the client
  secret in its host environment and nowhere else, allows only the listed origins, keeps nothing and
  sends no cache headers. One function serves every Gamerdex app. This package only calls it.
- Tokens expire after eight hours. `createTokenSource` renews a token that ends within a minute,
  renews once when calls overlap, and signs the player out only when GitHub refuses the refresh
  token or it has run out. A network or server failure keeps the player signed in.
- The public client IDs of all four providers and the address of the sign in service are in this
  package (`GITHUB_APP`, `CLIENT_IDS` and `AUTH_SERVICE_URL`), so a new app needs no sign in
  settings. A client ID is in every sign in address and is not a secret. The client secrets are only
  in the `gamerdex-auth` environment. An app may replace an ID with its own value, such as an
  environment variable that is set to another client ID. An empty value is the app's way to leave
  that provider out. Changing a default ID needs a new release of this package.
- The callback page checks the `state` value that it saved before sign in (`readCallback`).
- The tokens are saved in the browser on the device, outside the saved data, and are never synced.

## Google Drive notes

- Measured against the live API (2026-10-17): Drive ignores `If-Match` on updates, returns no ETag,
  and a metadata change raises `version`. It does keep one revision for each upload with different
  content, and each revision has an id and a readable body. The head revision id is the version.
- A write checks that the head revision equals the expected version, uploads, then lists the
  revisions and checks that the new revision sits directly on top of the expected one. A write by
  another device between the check and the upload would otherwise be lost, so its content is read
  from its revision and written back as the head, and `VersionConflictError` is thrown. The next
  sync merges both sides. The window for this is the time of one upload.
- A failure between the overwrite and the write back would leave the other device's content only in
  the revision history. Drive keeps revisions of uploaded files for a limited time.
- Creating a file or a folder can race too. After a create the provider lists the items with that
  name, keeps the oldest one and removes its own copy when it lost.
- `drive.file` is a non sensitive scope that needs only basic OAuth app verification. The app sees
  only files that it created, so every Gamerdex app shares one client and one `Gamerdex` folder.
- While the Google consent screen is in Testing, refresh tokens end after seven days. Publish the
  app to production before real players use it.
- Google's code exchange needs the client secret, so it runs in `gamerdex-auth`. Google's refresh
  answer has no new refresh token and no refresh lifetime, so the auth route fills both in.

## Dropbox notes

- An upload in `update` mode with the revision that was read fails when the file changed since, and
  an upload in `add` mode fails when the file exists. Both set `strict_conflict`, so a file that was
  removed since also fails, and both set `autorename` off, so Dropbox never makes a "conflicted
  copy". The failure is a 409 with a conflict tag and becomes `VersionConflictError`.
- A delete sends the revision as `parent_rev`. Dropbox does not say which error a revision that no
  longer matches gives, so the provider reads the file again after a not found answer and throws
  `VersionConflictError` when the file is still there.
- The app needs the App folder access type and the `files.content.read` and `files.content.write`
  scopes. The files sit under `Apps/<app name>/Gamerdex/<app id>/`.
- Dropbox refresh tokens do not expire and never change, and the refresh answer has none, so
  `gamerdex-auth` returns the refresh token that it was given, with a 180 day lifetime.
- An upload creates the folders of its path. The version is the `rev` that Dropbox returns.
- The file arguments travel in the `Dropbox-API-Arg` header, which must be ASCII, so the provider
  writes every other character as a `\u` escape.
- Written from the Dropbox documentation and tested against a fake. It still needs a run against the
  real API (`scripts/live-provider-check.mjs`), above all for the browser: the content endpoints
  must accept cross origin calls with this header and expose `Dropbox-API-Result`.

## OneDrive notes

- The app folder (`/me/drive/special/approot`) needs only the `Files.ReadWrite.AppFolder` scope.
  OneDrive creates it under `Apps` on the first call, named after the app registration. Microsoft
  documents it for personal accounts, so sign in uses the `consumers` endpoint.
- A write by path sends the `eTag` that was read in `If-Match`, and a new file is created with
  `conflictBehavior=fail`. Measured against the live API (2026-10-18, personal account): the simple
  `PUT` honors `If-Match`, so a stale write fails with 412. Creating a file that exists fails
  with 409. Of two parallel writes from one version, exactly one wins, for updates and for creates.
- A write with `If-Match` to a path that no longer has a file does not fail. OneDrive creates the
  file and answers 201, which would undo a removal that another device made. The provider removes
  the file that it just created, using the new `eTag`, and throws `VersionConflictError`. A change
  by another device in between is left alone. A 404 and a 412 also end as `VersionConflictError`.
- A read asks for the file metadata first and then for the content through the signed download
  address, which must not carry the token. The version is read before the content, so a change in
  between gives a stale version, which fails the next write and never overwrites silently.
- Microsoft throttles with 429 and sometimes 503, both with `Retry-After`.
- A refresh sends a new refresh token and the old one must be dropped. A refresh token ends after 90
  days without use. `gamerdex-auth` returns the new token with an 80 day lifetime.
- Sign in uses a Web redirect URI with a client secret, so the secret stays in `gamerdex-auth`. A
  single page application redirect would refuse the secret and end refresh tokens after 24 hours.

## Open points

- The exact wording of the conflict screen and the first sync choices belong to the app.
- A running timer is one record for each slot, and the later start wins. It stays an open decision
  in the Whiteout Survival design.
- The token function needs a host and the GitHub App needs to be registered.
