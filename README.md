# gamerdex-sync

Shared cloud sync for the Gamerdex apps. It keeps the saved data of an app in the player's own cloud
account, merges the data of several devices, and has no server that holds game data. The package is
open source and is built for the Gamerdex apps.

Status: early. The file layout, the meta file, the merge engine, the GitHub provider, the sync flow
and the sign in helpers are built. The plan and the decisions are in
[docs/design.md](docs/design.md).

## What an app provides

- An app id, such as `whiteout-survival`. It names the folder of the app.
- The saved data, as one JSON value, and a check that accepts or rejects a whole file.
- A merge schema that says how each part of the data merges, for example "a level takes the higher
  value" or "an owned flag is joined from both devices".

## Files in the cloud

```
Gamerdex/
  <app id>/
    data.json   the saved data of the app, in the same shape as its backup file
    meta.json   revisions and devices, with no game data and no token
```

## Development

```bash
pnpm install
pnpm test:coverage   # coverage must stay at 100 percent
pnpm lint
pnpm format:check
pnpm build
```
