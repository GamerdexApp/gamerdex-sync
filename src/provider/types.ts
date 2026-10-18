/** A file in the cloud. The version changes with every write and settles which write is newer. */
export interface RemoteFile {
  content: string;
  version: string;
}

/**
 * Where the files of an app are kept. A provider reads, writes and removes whole files by path, and
 * refuses a write that was made from an old version of the file. That refusal is what keeps two
 * devices from overwriting each other.
 */
export interface SyncProvider {
  /** Returns null when the file does not exist. */
  read(path: string): Promise<RemoteFile | null>;
  /**
   * Writes the file. The expected version is the version that was read, or null to create a file
   * that must not exist yet. Throws `VersionConflictError` when the file changed since.
   */
  write(
    path: string,
    content: string,
    expectedVersion: string | null,
  ): Promise<{ version: string }>;
  /** Removes the file. Throws `VersionConflictError` when the file changed since. */
  remove(path: string, expectedVersion: string): Promise<void>;
}

/** The file changed in the cloud after it was read. Read it again and merge. */
export class VersionConflictError extends Error {
  constructor(public readonly path: string) {
    super(`The file ${path} changed in the cloud.`);
    this.name = 'VersionConflictError';
  }
}

export type ProviderErrorKind =
  /** The token is missing, expired, revoked or has no permission. The player signs in again. */
  | 'auth'
  /** The provider limits the calls for now. Try again after `retryAfterSeconds`. */
  | 'rate-limit'
  /** The repository or folder does not exist, or the token cannot see it. */
  | 'not-found'
  /** The device is offline or the provider cannot be reached. */
  | 'network'
  /** The provider failed. A later try may work. */
  | 'server'
  /** The provider answered with something this package does not understand. */
  | 'invalid';

export class ProviderError extends Error {
  constructor(
    public readonly kind: ProviderErrorKind,
    message: string,
    public readonly status?: number,
    public readonly retryAfterSeconds?: number,
    /** The message that the provider sent with the failed request, when it sent one. */
    public readonly detail?: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
