import { Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CacheService } from '../cache/cache.service';
import { OanorApiService } from '../oanor/oanor-api.service';
import { HistoryService } from './history.service';
import { toStock } from './mappers';
import { marketPhase, sessionClosedToday } from './market-hours';
import { Sourced, Stock } from './models';
import { sourced } from './quality';
import { confirmedRealtime, ttlMs } from './ttl';

const UNIVERSE_TTL = 12 * 3600 * 1000;
interface Loaded<T> { payload: T; providerTimestamp: string | null }

@Injectable()
export class StockService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(StockService.name);
  private eodTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly api: OanorApiService,
    private readonly cache: CacheService,
    private readonly history: HistoryService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    // After each session closes, make sure one complete bar per stock is captured
    // (costs ~5 calls per trading day). Checked every 15 minutes.
    this.eodTimer = setInterval(() => this.captureEodIfNeeded().catch(() => undefined), 15 * 60 * 1000);
  }
  onModuleDestroy() { if (this.eodTimer) clearInterval(this.eodTimer); }

  /**
   * Universe of listed stocks = the provider's market-cap screener at its max
   * limit (100). The provider ranks "only real stocks above a market-cap floor",
   * so very small caps may be missing; they remain reachable via /stocks/:symbol.
   */
  private universe() {
    return this.cache.getOrLoad<string[]>('universe', UNIVERSE_TTL, async () => {
      const res = await this.api.screener('marketcap', 100);
      return res.data.results.map((r) => r.ticker);
    });
  }

  /** All covered stocks with full quotes, fetched in batches of 20 (provider max). */
  async all(): Promise<Sourced<Stock[]>> {
    const r = await this.cache.getOrLoad<Loaded<Stock[]>>('stocks:all', ttlMs(this.config), async () => {
      const uni = await this.universe();
      if (!uni.value) throw new Error(uni.error ?? 'Could not load the list of stocks');
      const batches: string[][] = [];
      for (let i = 0; i < uni.value.length; i += 20) batches.push(uni.value.slice(i, i + 20));
      const stocks: Stock[] = [];
      let ts: string | null = null;
      for (const b of batches) {
        const res = await this.api.quote(b);
        ts = res.meta?.timestamp ?? ts;
        stocks.push(...res.data.quotes.map(toStock));
      }
      stocks.forEach((s) => this.history.record(s.symbol, {
        open: s.open, high: s.high, low: s.low, close: s.price, volume: s.volume,
      }));
      return { payload: stocks, providerTimestamp: ts };
    });
    return sourced(r, marketPhase(), confirmedRealtime(this.config));
  }

  async one(symbol: string): Promise<Sourced<Stock>> {
    const sym = symbol.toUpperCase();
    if (!/^[A-Z0-9]{1,10}$/.test(sym)) throw new NotFoundException(`Invalid ticker "${symbol}"`);
    const all = await this.all();
    const hit = all.data?.find((s) => s.symbol === sym);
    if (hit) return { ...all, data: hit };

    // Not in the screener universe: ask the provider for this ticker alone.
    const r = await this.cache.getOrLoad<Loaded<Stock | null>>(`quote:${sym}`, ttlMs(this.config), async () => {
      const res = await this.api.quote([sym]);
      const q = res.data.quotes.find((x) => x.ticker?.toUpperCase() === sym);
      const s = q ? toStock(q) : null;
      if (s) this.history.record(s.symbol, { open: s.open, high: s.high, low: s.low, close: s.price, volume: s.volume });
      return { payload: s, providerTimestamp: res.meta?.timestamp ?? null };
    });
    if (r.value && r.value.payload === null) throw new NotFoundException(`The provider returned no quote for "${sym}"`);
    return sourced(r as never, marketPhase(), confirmedRealtime(this.config));
  }

  private async captureEodIfNeeded() {
    if (!sessionClosedToday() || marketPhase() !== 'CLOSED') return;
    const { date, complete } = HistoryService.sessionFor();
    if (!complete || this.history.hasCompleteBar('MASI', date)) return;
    this.log.log(`Capturing end-of-day bars for ${date}`);
    // Force a refresh by using a dedicated key (the TTL cache may still hold intraday data).
    const r = await this.cache.getOrLoad<boolean>(`eod:${date}`, 24 * 3600 * 1000, async () => {
      const uni = await this.universe();
      for (let i = 0; uni.value && i < uni.value.length; i += 20) {
        const res = await this.api.quote(uni.value.slice(i, i + 20));
        res.data.quotes.map(toStock).forEach((s) => this.history.record(s.symbol, {
          open: s.open, high: s.high, low: s.low, close: s.price, volume: s.volume,
        }));
      }
      const idx = await this.api.index('MASI');
      this.history.record('MASI', {
        open: idx.data.open ?? null, high: idx.data.high ?? null, low: idx.data.low ?? null,
        close: idx.data.value ?? null, volume: null,
      });
      return true;
    });
    if (r.error) this.log.warn(`EOD capture failed: ${r.error}`);
  }
}
