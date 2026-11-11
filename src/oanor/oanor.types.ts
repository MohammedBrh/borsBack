/**
 * Raw response shapes of the Oanor Casablanca Stock Exchange API.
 * Taken from the provider's OpenAPI spec:
 * https://www.oanor.com/api/casablanca-stock-api/openapi.json
 * Every numeric field is optional on purpose: we never assume a value exists.
 */
export interface OanorEnvelope<T> {
  success: boolean;
  status: string;
  message: string;
  data: T;
  meta: { timestamp: string; request_id: string };
}

export interface OanorQuote {
  ticker: string;
  company?: string;
  sector?: string;
  currency?: string;
  price?: number;
  change?: number;
  change_percent?: number;
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
  market_cap?: number;
  pe_ratio?: number;
}

export interface OanorQuoteData {
  count: number;
  quotes: OanorQuote[];
  source?: string;
  note?: string;
}

/** Screener rows have no open/high/low/pe_ratio. */
export type OanorScreenerRow = Omit<OanorQuote, 'open' | 'high' | 'low' | 'pe_ratio'>;

export interface OanorScreenerData {
  by: 'gainers' | 'losers' | 'active' | 'marketcap';
  count: number;
  results: OanorScreenerRow[];
  description?: string;
  source?: string;
}

export interface OanorIndexData {
  index: string;
  name?: string;
  value?: number;
  change?: number;
  change_percent?: number;
  open?: number;
  high?: number;
  low?: number;
  source?: string;
}

export interface OanorMetaData {
  service: string;
  source?: string;
  indexes?: string[];
  screens?: string[];
  upstream_status?: string;
  endpoints?: Record<string, string>;
}
