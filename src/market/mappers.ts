import { OanorIndexData, OanorQuote, OanorScreenerRow } from '../oanor/oanor.types';
import { IndexValue, Stock } from './models';
import { num, round } from './quality';

export function toStock(q: OanorQuote | OanorScreenerRow): Stock {
  const full = q as OanorQuote;
  const price = num(q.price);
  const change = num(q.change);
  const volume = num(q.volume);
  return {
    symbol: q.ticker,
    name: q.company ?? null,
    sector: q.sector ?? null,
    currency: q.currency ?? 'MAD',
    price,
    change: round(change, 4),
    changePercent: num(q.change_percent),
    previousClose: price !== null && change !== null ? round(price - change, 4) : null,
    open: num(full.open),
    high: num(full.high),
    low: num(full.low),
    volume,
    turnover: price !== null && volume !== null ? Math.round(price * volume) : null,
    marketCap: num(q.market_cap),
    peRatio: num(full.pe_ratio),
  };
}

export function toIndex(d: OanorIndexData): IndexValue {
  return {
    code: d.index,
    name: d.name ?? null,
    value: num(d.value),
    change: round(num(d.change), 2),
    changePercent: num(d.change_percent),
    open: num(d.open),
    high: num(d.high),
    low: num(d.low),
  };
}
