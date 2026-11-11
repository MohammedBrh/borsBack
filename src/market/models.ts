export type DataQuality = 'LIVE' | 'DELAYED' | 'EOD' | 'STALE' | 'UNAVAILABLE';
export type MarketPhase = 'PRE_OPEN' | 'OPEN' | 'CLOSED';

/** Wraps every payload sent to the frontend with provenance information. */
export interface Sourced<T> {
  data: T | null;
  quality: DataQuality;
  source: string;
  /** When the provider produced the data (provider meta.timestamp). */
  providerTimestamp: string | null;
  /** When this backend fetched it from the provider. */
  fetchedAt: string | null;
  marketPhase: MarketPhase;
  error?: string;
}

export interface Stock {
  symbol: string;
  name: string | null;
  sector: string | null;
  currency: string;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  /** Derived as price - change (the provider gives the change vs previous close). */
  previousClose: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  /** Traded value in MAD estimated as price x volume. */
  turnover: number | null;
  marketCap: number | null;
  peRatio: number | null;
}

export interface IndexValue {
  code: string;
  name: string | null;
  value: number | null;
  change: number | null;
  changePercent: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
}

export interface SectorSummary {
  sector: string;
  count: number;
  marketCap: number;
  /** Market-cap-weighted average daily change, computed by this app. */
  weightedChangePercent: number | null;
  advancers: number;
  decliners: number;
}

export interface MarketOverview {
  index: IndexValue | null;
  totalMarketCap: number | null;
  totalVolume: number | null;
  totalTurnover: number | null;
  breadth: { advancers: number; decliners: number; unchanged: number };
  topGainers: Stock[];
  topLosers: Stock[];
  mostActive: Stock[];
  sectors: SectorSummary[];
  coverage: { stocks: number; note: string };
}

export interface ScreenerResult {
  gainers: Stock[];
  losers: Stock[];
  active: Stock[];
  marketcap: Stock[];
}

export interface DailyBar {
  date: string; // YYYY-MM-DD, Casablanca date
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  /** true once captured after the session closed (the close is final). */
  complete: boolean;
  capturedAt: string;
}

export interface Level {
  label: string;
  price: number;
  kind: 'resistance' | 'support' | 'pivot';
  method: 'pivot-classic' | 'pivot-fibonacci' | 'intraday' | 'swing';
  /** distance from current price in % (positive = above). */
  distancePercent: number | null;
}

export interface LevelsResult {
  symbol: string;
  price: number | null;
  basis: {
    session: 'previous-complete' | 'current-provisional';
    date: string | null;
    high: number;
    low: number;
    close: number;
  } | null;
  pivot: number | null;
  classic: Level[];
  fibonacci: Level[];
  intraday: Level[];
  swing: Level[];
  /** Closest level above / below the current price, across all methods. */
  nearestResistance: Level | null;
  nearestSupport: Level | null;
  historySessions: number;
  notes: string[];
}
