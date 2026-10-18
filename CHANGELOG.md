# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- The file layout of an app in the shared `Gamerdex` folder and the meta file with its revisions.
- `merge()`, a three way merge of saved data driven by a schema, and `resolveConflict()` to apply
  the side that the player picks.
- `SyncProvider`, the interface of a place that keeps the files, with `VersionConflictError` and
  `ProviderError`. `GitHubProvider` keeps the files in a private repository through the contents
  API, and `MemoryProvider` keeps them in memory for tests.
- `sync()`, the flow that reads the cloud, merges the three copies, writes the cloud when it changed
  and returns the data and state to store. It retries when another device wrote first, asks for a
  choice on the first sync when both sides hold data, and checks the data before any write.
- Sign in with GitHub: `createTokenSource()` keeps a player signed in and renews tokens before they
  end. URL helpers build the sign in and install addresses and check the state of the callback.
