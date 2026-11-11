import { CacheResult } from '../cache/cache.service';
import { DataQuality, MarketPhase, Sourced } from './models';

export const SOURCE_LABEL = 'Oanor Casablanca Stock Exchange API (upstream: TradingView public screener)';

/**
 * Data-quality rules (never upgrade a label we cannot prove):
 *  - no value                         -> UNAVAILABLE
 *  - value kept after a failed refresh -> STALE
 *  - fresh, market in session         -> DELAYED (LIVE only if OANOR_CONFIRMED_REALTIME=true)
 *  - fresh, market closed / pre-open  -> EOD (last completed session)
 */
export function qualityFor(r: CacheResult<unknown>, phase: MarketPhase, confirmedRealtime: boolean): DataQuality {
  if (r.value === null || r.value === undefined) return 'UNAVAILABLE';
  if (r.stale) return 'STALE';
  if (phase === 'OPEN') return confirmedRealtime ? 'LIVE' : 'DELAYED';
  return 'EOD';
}

export function sourced<T, R = T>(
  r: CacheResult<{ payload: T; providerTimestamp: string | null }>,
  phase: MarketPhase,
  confirmedRealtime: boolean,
  map?: (t: T) => R,
): Sourced<R> {
  const v = r.value;
  let quality = qualityFor(r, phase, confirmedRealtime);
  // Guard: if the provider itself stamps its answer more than 3 days old, it is serving old data.
  if (v?.providerTimestamp && quality !== 'UNAVAILABLE' && Date.now() - Date.parse(v.providerTimestamp) > 72 * 3600 * 1000) {
    quality = 'STALE';
  }
  return {
    data: v ? (map ? map(v.payload) : (v.payload as unknown as R)) : null,
    quality,
    source: SOURCE_LABEL,
    providerTimestamp: v?.providerTimestamp ?? null,
    fetchedAt: r.storedAt ? new Date(r.storedAt).toISOString() : null,
    marketPhase: phase,
    ...(r.error ? { error: r.error } : {}),
  };
}

export function num(x: unknown): number | null {
  return typeof x === 'number' && Number.isFinite(x) ? x : null;
}

export function round(x: number | null, d = 2): number | null {
  if (x === null) return null;
  const f = 10 ** d;
  return Math.round(x * f) / f;
}
