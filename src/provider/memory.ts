import { RemoteFile, SyncProvider, VersionConflictError } from './types';

/**
 * A provider that keeps the files in memory. It follows the same version rules as a real provider,
 * so the sync flow of an app can be tested without a network.
 */
export class MemoryProvider implements SyncProvider {
  private files = new Map<string, { content: string; counter: number }>();
  private counter = 0;

  async read(path: string): Promise<RemoteFile | null> {
    const file = this.files.get(path);
    return file ? { content: file.content, version: String(file.counter) } : null;
  }

  async write(
    path: string,
    content: string,
    expectedVersion: string | null,
  ): Promise<{ version: string }> {
    const current = this.files.get(path);
    const currentVersion = current ? String(current.counter) : null;
    if (currentVersion !== expectedVersion) throw new VersionConflictError(path);
    this.counter += 1;
    this.files.set(path, { content, counter: this.counter });
    return { version: String(this.counter) };
  }

  async remove(path: string, expectedVersion: string): Promise<void> {
    const current = this.files.get(path);
    if (current && String(current.counter) !== expectedVersion) {
      throw new VersionConflictError(path);
    }
    this.files.delete(path);
  }

  /** The paths of the files that exist, in the order they were first written. */
  paths(): string[] {
    return [...this.files.keys()];
  }
}
