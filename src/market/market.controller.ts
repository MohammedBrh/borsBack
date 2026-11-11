import { Controller, Get, Param, ParseIntPipe, DefaultValuePipe, Query } from '@nestjs/common';
import { IndexService } from './index.service';
import { MarketDataService } from './market-data.service';
import { ScreenerService } from './screener.service';
import { StockService } from './stock.service';

@Controller('market')
export class MarketController {
  constructor(
    private readonly market: MarketDataService,
    private readonly stocks: StockService,
    private readonly screener: ScreenerService,
    private readonly index: IndexService,
  ) {}

  @Get('overview') overview() { return this.market.overview(); }

  @Get('stocks') all() { return this.stocks.all(); }

  @Get('stocks/:symbol') one(@Param('symbol') symbol: string) { return this.stocks.one(symbol); }

  /** Support & resistance levels for one stock. */
  @Get('stocks/:symbol/levels') levels(@Param('symbol') symbol: string) { return this.market.levels(symbol); }

  @Get('stocks/:symbol/history') history(@Param('symbol') symbol: string) { return this.market.stockHistory(symbol); }

  @Get('screener')
  screen(@Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number) {
    return this.screener.get(Math.min(50, Math.max(1, limit)));
  }

  @Get('index') idx(@Query('name') name?: string) { return this.index.get(name || 'MASI'); }

  @Get('index/history') idxHistory(@Query('name') name?: string) { return this.market.stockHistory(name || 'MASI'); }

  @Get('health') health(@Query('probe') probe?: string) { return this.market.health(probe === 'true'); }
}
