import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CacheService } from '../cache/cache.service';
import { OanorApiService } from '../oanor/oanor-api.service';
import { HistoryService } from './history.service';
import { toIndex } from './mappers';
import { marketPhase } from './market-hours';
import { IndexValue, Sourced } from './models';
import { sourced } from './quality';
import { confirmedRealtime, ttlMs } from './ttl';

@Injectable()
export class IndexService {
  constructor(
    private readonly api: OanorApiService,
    private readonly cache: CacheService,
    private readonly history: HistoryService,
    private readonly config: ConfigService,
  ) {}

  /** The provider currently exposes only MASI (see GET /v1/meta -> indexes). */
  async get(name = 'MASI'): Promise<Sourced<IndexValue>> {
    const code = name.toUpperCase();
    const r = await this.cache.getOrLoad(`index:${code}`, ttlMs(this.config), async () => {
      const res = await this.api.index(code);
      const v = toIndex(res.data);
      this.history.record(v.code, { open: v.open, high: v.high, low: v.low, close: v.value, volume: null });
      return { payload: v, providerTimestamp: res.meta?.timestamp ?? null };
    });
    return sourced(r, marketPhase(), confirmedRealtime(this.config));
  }
}
