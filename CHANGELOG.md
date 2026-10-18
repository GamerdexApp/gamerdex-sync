# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] - 2026-10-18

### Added

- `DropboxProvider` keeps the files in the app folder of the Dropbox of the player. It writes with
  the revision that was read and fails with a version conflict when the file changed since.
- `OneDriveProvider` keeps the files in the app folder of the OneDrive of a personal Microsoft
  account. It writes with the `eTag` that was read and creates a new file only when none exists.
- `dropboxAuthorizeUrl()` with `DROPBOX_SCOPES`, and `microsoftAuthorizeUrl()` with
  `ONEDRIVE_FILE_SCOPE` and `ONEDRIVE_SCOPES`, for the two sign in pages.
- `ProviderError.detail` also reads the summary of a failed Dropbox request.

## [0.2.1] - 2026-10-18

### Fixed

- `GoogleDriveProvider` no longer fails when the Drive search does not list a file or folder that it
  has just created. Drive can lag behind a create, so the provider now counts the new item with the
  creation time that Drive returns.

## [0.2.0] - 2026-10-17

### Added

- `GoogleDriveProvider` keeps the files in the Google Drive of the player, in a visible `Gamerdex`
  folder, with the narrow `drive.file` scope. Drive cannot refuse a write made from an old version,
  so the provider checks the head revision before the upload and the revision list after it. When
  another device wrote in between, its content is put back and the sync merges both sides.
- `googleAuthorizeUrl()` and `GOOGLE_DRIVE_SCOPE` for the Google sign in page.
- `ProviderError.detail` also reads the message of a failed Google request.

## [0.1.1] - 2026-10-17

### Added

- `ProviderError.detail` carries the message that GitHub sends with a failed request, such as
  "Resource not accessible by integration", so an app can log the reason of a failure.

### Changed

- A sync that changes nothing no longer writes the meta file, so the repository gets no empty
  commits. The meta file is still written when data is uploaded, when a device syncs for the first
  time, and when the app changes the revisions.

## [0.1.0] - 2026-10-17

First release.

### Added

- The file layout of an app in the shared `Gamerdex` folder, and the meta file that holds revisions
  and devices.
- `merge()`, a three way merge of saved data driven by a schema, and `resolveConflict()` to apply
  the side that the player picks. A value of one device, such as the active chief, never changes the
  cloud.
- `SyncProvider`, the interface of a place that keeps the files, with `VersionConflictError` and
  `ProviderError`. `GitHubProvider` keeps the files in a private repository through the contents
  API, and `MemoryProvider` keeps them in memory for tests.
- `listInstalledRepositories()`, which lists the repositories that a player gave to the GitHub App.
- `sync()`, the flow that reads the cloud, merges the three copies, writes the cloud when it changed
  and returns the data and state to store. It retries when another device wrote first, asks for a
  choice on the first sync when both sides hold data, and checks the data before any write.
- Sign in with GitHub: `createTokenSource()` keeps a player signed in and renews tokens before they
  end. URL helpers build the sign in and install addresses and check the state of the callback.
