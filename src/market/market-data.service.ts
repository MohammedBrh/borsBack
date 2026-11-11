import { Injectable } from '@nestjs/common';
import { CacheService } from '../cache/cache.service';
import { OanorApiService } from '../oanor/oanor-api.service';
import { HistoryService } from './history.service';
import { computeLevels } from './levels';
import { marketPhase } from './market-hours';
import { DailyBar, LevelsResult, MarketOverview, SectorSummary, Sourced, Stock } from './models';
import { ScreenerService } from './screener.service';
import { IndexService } from './index.service';
import { StockService } from './stock.service';

@Injectable()
export class MarketDataService {
  constructor(
    private readonly stocks: StockService,
    private readonly index: IndexService,
    private readonly history: HistoryService,
    private readonly cache: CacheService,
    private readonly api: OanorApiService,
  ) {}

  static sectors(stocks: Stock[]): SectorSummary[] {
    const map = new Map<string, Stock[]>();
    stocks.forEach((s) => {
      const k = s.sector ?? 'Unclassified';
      map.set(k, [...(map.get(k) ?? []), s]);
    });
    return [...map.entries()].map(([sector, list]) => {
      const withCap = list.filter((s) => s.marketCap !== null && s.changePercent !== null);
      const cap = withCap.reduce((a, s) => a + (s.marketCap as number), 0);
      return {
        sector,
        count: list.length,
        marketCap: list.reduce((a, s) => a + (s.marketCap ?? 0), 0),
        weightedChangePercent: cap > 0
          ? Math.round((withCap.reduce((a, s) => a + (s.marketCap as number) * (s.changePercent as number), 0) / cap) * 100) / 100
          : null,
        advancers: list.filter((s) => (s.changePercent ?? 0) > 0).length,
        decliners: list.filter((s) => (s.changePercent ?? 0) < 0).length,
      };
    }).sort((a, b) => b.marketCap - a.marketCap);
  }

  async overview(): Promise<Sourced<MarketOverview> & { indexStatus: Omit<Sourced<unknown>, 'data'> }> {
    const [all, idx] = await Promise.all([this.stocks.all(), this.index.get('MASI')]);
    const list = all.data ?? [];
    const sum = (f: (s: Stock) => number | null) => {
      const v = list.map(f).filter((x): x is number => x !== null);
      return v.length ? v.reduce((a, b) => a + b, 0) : null;
    };
    const ranks = ScreenerService.rank(list, 5);
    const data: MarketOverview | null = (all.data || idx.data) ? {
      index: idx.data,
      totalMarketCap: sum((s) => s.marketCap),
      totalVolume: sum((s) => s.volume),
      totalTurnover: sum((s) => s.turnover),
      breadth: {
        advancers: list.filter((s) => (s.change ?? 0) > 0).length,
        decliners: list.filter((s) => (s.change ?? 0) < 0).length,
        unchanged: list.filter((s) => s.change === 0).length,
      },
      topGainers: ranks.gainers,
      topLosers: ranks.losers,
      mostActive: ranks.active,
      sectors: MarketDataService.sectors(list),
      coverage: {
        stocks: list.length,
        note: 'Totals cover the stocks returned by the provider screener (stocks above its market-cap floor). Turnover is estimated as price x volume.',
      },
    } : null;
    // Overview quality = the stocks dataset quality; the index carries its own.
    const { data: _ignored, ...indexStatus } = idx;
    return { ...all, data, indexStatus };
  }

  async levels(symbol: string): Promise<Sourced<LevelsResult>> {
    const s = await this.stocks.one(symbol);
    if (!s.data) return { ...s, data: null };
    const { date } = HistoryService.sessionFor();
    return { ...s, data: computeLevels(s.data, this.history.bars(s.data.symbol), marketPhase(), date) };
  }

  stockHistory(symbol: string): { symbol: string; bars: DailyBar[]; note: string } {
    return {
      symbol: symbol.toUpperCase(),
      bars: this.history.bars(symbol.toUpperCase()),
      note: 'Daily bars recorded by this app from provider snapshots since it was first run. The free provider has no historical endpoint; nothing is back-filled.',
    };
  }

  async health(probe: boolean) {
    let upstream: { ok: boolean; detail: string } | null = null;
    if (probe) {
      try {
        const m = await this.api.meta();
        upstream = { ok: true, detail: `upstream_status=${m.data.upstream_status ?? 'unknown'}, indexes=${(m.data.indexes ?? []).join(',')}` };
      } catch (e) {
        upstream = { ok: false, detail: (e as Error).message };
      }
    }
    return {
      status: this.api.hasKey ? 'configured' : 'missing-api-key',
      marketPhase: marketPhase(),
      now: new Date().toISOString(),
      provider: this.api.usage(),
      upstream,
      cache: this.cache.stats(),
      history: this.history.stats(),
    };
  }
}
