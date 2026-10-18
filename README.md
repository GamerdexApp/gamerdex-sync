# gamerdex-sync

Shared cloud sync for the Gamerdex apps. It keeps the saved data of an app in the player's own cloud
account, merges the data of several devices, and has no server that holds game data. The package is
open source and is built for the Gamerdex apps.

Status: first release, 0.1.0. The file layout, the meta file, the merge engine, the GitHub provider,
the sync flow and the sign in helpers are built. The plan and the decisions are in
[docs/design.md](docs/design.md).

## Install

```bash
pnpm add @gamerdexapp/gamerdex-sync
```

## Use

```ts
import { MemoryProvider, type Schema, sync } from "@gamerdexapp/gamerdex-sync";

const schema: Schema = {
  type: "object",
  each: { type: "object", each: { type: "max", order: (value) => Number(value) } },
};

const result = await sync({
  appId: "my-app",
  deviceId: "device-1",
  deviceName: "Laptop",
  provider: new MemoryProvider(), // GitHubProvider in an app
  schema,
  local: { chief: { level: 5 } },
  state: null, // the state that the last sync returned, or null on the first sync
  now: () => new Date().toISOString(),
});

if (result.status === "synced") {
  // Store result.data and result.state on the device, and show result.conflicts.
}
```

`sync()` returns `needs-choice` on the first sync when the device and the cloud both hold different
data. Call it again with `firstSync` set to `merge`, `keep-local` or `keep-cloud`.

## What an app provides

- An app id, such as `whiteout-survival-tracker`. It names the folder of the app.
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

## Releasing

1. Move the `Unreleased` entries of `CHANGELOG.md` under a heading such as
   `## [0.2.0] - 2026-11-01`, and set the same version in `package.json`.
2. Merge to `main`.
3. Run the `Publish` workflow from the Actions tab. It publishes to npm when that version is not
   there yet, then creates the GitHub release from the changelog.

The workflow has no npm token. It uses npm trusted publishing, which needs a one time setup on
npmjs.com (see the package settings, Trusted publisher). The first release of a new package is
published by hand.

## Development

```bash
pnpm install
pnpm test:coverage   # coverage must stay at 100 percent
pnpm lint
pnpm format:check
pnpm build
```
