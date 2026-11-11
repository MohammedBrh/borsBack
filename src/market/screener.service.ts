import { Injectable } from '@nestjs/common';
import { Sourced, ScreenerResult, Stock } from './models';
import { StockService } from './stock.service';

/**
 * Rankings are computed from the same full quote set used everywhere else, so
 * every page shows numbers from one consistent snapshot and we spend no extra
 * provider calls (the free plan has 7,900 calls/month).
 */
@Injectable()
export class ScreenerService {
  constructor(private readonly stocks: StockService) {}

  static rank(stocks: Stock[], limit: number): ScreenerResult {
    const valid = stocks.filter((s) => s.price !== null);
    const by = (f: (s: Stock) => number | null, dir: 1 | -1) =>
      [...valid].filter((s) => f(s) !== null).sort((a, b) => dir * ((f(a) as number) - (f(b) as number)));
    return {
      gainers: by((s) => s.changePercent, -1).filter((s) => (s.changePercent ?? 0) > 0).slice(0, limit),
      losers: by((s) => s.changePercent, 1).filter((s) => (s.changePercent ?? 0) < 0).slice(0, limit),
      active: by((s) => s.turnover, -1).filter((s) => (s.volume ?? 0) > 0).slice(0, limit),
      marketcap: by((s) => s.marketCap, -1).slice(0, limit),
    };
  }

  async get(limit = 10): Promise<Sourced<ScreenerResult>> {
    const all = await this.stocks.all();
    return { ...all, data: all.data ? ScreenerService.rank(all.data, limit) : null };
  }
}
