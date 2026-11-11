import { Injectable, Logger } from '@nestjs/common';

interface Entry<T> { value: T; storedAt: number; expiresAt: number; }

export interface CacheResult<T> {
  value: T | null;
  storedAt: number | null;
  /** true when the value is past its TTL and was served because the refresh failed. */
  stale: boolean;
  error?: string;
}

/**
 * Small in-memory TTL cache with:
 *  - in-flight de-duplication (concurrent callers share one upstream request)
 *  - stale-on-error fallback (an old value is better than nothing, but is flagged)
 */
@Injectable()
export class CacheService {
  private readonly log = new Logger(CacheService.name);
  private readonly store = new Map<string, Entry<unknown>>();
  private readonly inflight = new Map<string, Promise<CacheResult<unknown>>>();

  async getOrLoad<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<CacheResult<T>> {
    const hit = this.store.get(key) as Entry<T> | undefined;
    if (hit && hit.expiresAt > Date.now()) {
      return { value: hit.value, storedAt: hit.storedAt, stale: false };
    }
    const running = this.inflight.get(key);
    if (running) return running as Promise<CacheResult<T>>;

    const p = (async (): Promise<CacheResult<T>> => {
      try {
        const value = await loader();
        const now = Date.now();
        this.store.set(key, { value, storedAt: now, expiresAt: now + ttlMs });
        return { value, storedAt: now, stale: false };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (hit) {
          this.log.warn(`Serving stale "${key}" (${msg})`);
          return { value: hit.value, storedAt: hit.storedAt, stale: true, error: msg };
        }
        return { value: null, storedAt: null, stale: false, error: msg };
      } finally {
        this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, p);
    return p;
  }

  peek<T>(key: string): Entry<T> | undefined {
    return this.store.get(key) as Entry<T> | undefined;
  }

  stats() {
    return { keys: [...this.store.keys()], size: this.store.size };
  }
}
