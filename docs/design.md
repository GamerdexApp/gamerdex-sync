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
| Provider       | GitHub first. A private repository that the player owns. Google Drive, Dropbox and OneDrive follow later behind the same interface.                                                                                                      |
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
- The callback page checks the `state` value that it saved before sign in (`readCallback`).
- The tokens are saved in the browser on the device, outside the saved data, and are never synced.

## Open points

- The exact wording of the conflict screen and the first sync choices belong to the app.
- A running timer is one record for each slot, and the later start wins. It stays an open decision
  in the Whiteout Survival design.
- The token function needs a host and the GitHub App needs to be registered.
