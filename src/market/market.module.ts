import { Module } from '@nestjs/common';
import { CacheService } from '../cache/cache.service';
import { OanorApiService } from '../oanor/oanor-api.service';
import { HistoryService } from './history.service';
import { IndexService } from './index.service';
import { MarketController } from './market.controller';
import { MarketDataService } from './market-data.service';
import { ScreenerService } from './screener.service';
import { StockService } from './stock.service';

@Module({
  controllers: [MarketController],
  providers: [OanorApiService, CacheService, HistoryService, StockService, IndexService, ScreenerService, MarketDataService],
})
export class MarketModule {}
