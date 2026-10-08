/**
 * Memoizes HIS calls for the duration of ONE agent run, so tools that need the same data
 * (e.g. getLabResults then getLabValues) share a single HIS call. Failed calls are not cached.
 */
export class RequestCache {
  private readonly entries = new Map<string, Promise<unknown>>();

  memo<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.entries.get(key);
    if (hit) return hit as Promise<T>;

    const pending = load().catch((err: unknown) => {
      this.entries.delete(key);
      throw err;
    });
    this.entries.set(key, pending);
    return pending;
  }
}
