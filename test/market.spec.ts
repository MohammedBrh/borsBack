/**
 * Fixtures = the example responses published in Oanor's OpenAPI spec
 * (https://www.oanor.com/api/casablanca-stock-api/openapi.json). They are used
 * only to test parsing and calculations; the app never displays them.
 */
import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import { ConfigService } from '@nestjs/config';
import { OanorApiService } from '../src/oanor/oanor-api.service';
import { toIndex, toStock } from '../src/market/mappers';
import { computeLevels } from '../src/market/levels';
import { ScreenerService } from '../src/market/screener.service';
import { qualityFor } from '../src/market/quality';
import { casablancaParts, marketPhase } from '../src/market/market-hours';
import { HistoryService } from '../src/market/history.service';
import { DailyBar } from '../src/market/models';
import quote from './fixtures/quote.json';
import screener from './fixtures/screener.json';
import index from './fixtures/index.json';

describe('mapping provider payloads', () => {
  it('maps a quote and derives previous close and turnover', () => {
    const atw = toStock(quote.data.quotes[0]);
    expect(atw).toMatchObject({ symbol: 'ATW', price: 680, previousClose: 665, open: 678, high: 685, low: 675, peRatio: 12.75 });
    expect(atw.turnover).toBe(680 * 48104);
  });
  it('screener rows have no OHL/PE and stay null (never invented)', () => {
    const mng = toStock(screener.data.results[0]);
    expect(mng.open).toBeNull();
    expect(mng.peRatio).toBeNull();
  });
  it('maps the MASI index', () => {
    expect(toIndex(index.data)).toMatchObject({ code: 'MASI', value: 17952.37, changePercent: 1.86 });
  });
});

describe('screener ranking', () => {
  const stocks = screener.data.results.map(toStock);
  const r = ScreenerService.rank(stocks, 5);
  it('ranks gainers/losers by % change, excluding the wrong sign', () => {
    expect(r.gainers.map((s) => s.symbol)).toEqual(['MNG', 'ATW', 'IAM']);
    expect(r.losers.map((s) => s.symbol)).toEqual(['LHM', 'CMA']);
  });
  it('ranks activity by traded value', () => {
    expect(r.active[0].symbol).toBe('MNG'); // 13635 x 2651 > 680 x 48104
  });
});

describe('support / resistance', () => {
  const atw = toStock(quote.data.quotes[0]); // H 685, L 675, C 680
  it('computes classic pivots from a completed session', () => {
    const lv = computeLevels(atw, [], 'CLOSED', '2026-06-12');
    const by = Object.fromEntries(lv.classic.map((l) => [l.label, l.price]));
    expect(lv.pivot).toBe(680);
    expect(by).toEqual({ R3: 695, R2: 690, R1: 685, P: 680, S1: 675, S2: 670, S3: 665 });
    expect(lv.basis?.session).toBe('previous-complete');
    expect(lv.nearestResistance?.price).toBe(683.82); // Fibonacci R1 = 680 + 0.382 x 10
  });
  it('marks pivots provisional during the session when no previous bar exists', () => {
    const lv = computeLevels(atw, [], 'OPEN', '2026-06-15');
    expect(lv.basis?.session).toBe('current-provisional');
  });
  it('uses the recorded previous session during market hours', () => {
    const prev: DailyBar = { date: '2026-06-12', open: 660, high: 670, low: 655, close: 665, volume: 1, complete: true, capturedAt: '' };
    const lv = computeLevels(atw, [prev], 'OPEN', '2026-06-15');
    expect(lv.basis).toMatchObject({ date: '2026-06-12', high: 670, low: 655, close: 665 });
    expect(lv.pivot).toBe(663.33);
    // price 680 is above R2 (678.33) -> R1/R2 now act as support
    expect(lv.classic.find((l) => l.label === 'R2')?.kind).toBe('support');
  });
  it('needs 10 recorded sessions for swing levels', () => {
    const bars: DailyBar[] = Array.from({ length: 12 }, (_, i) => ({
      date: `2026-05-${String(i + 1).padStart(2, '0')}`, open: 650, high: 660 + (i === 5 ? 40 : i), low: 640 - (i === 3 ? 20 : 0),
      close: 655, volume: 1, complete: true, capturedAt: '',
    }));
    const lv = computeLevels(atw, bars, 'CLOSED', '2026-06-12');
    expect(lv.swing.find((l) => l.label.endsWith('session high'))?.price).toBe(700);
    expect(lv.swing.find((l) => l.label === 'Swing high 1')?.price).toBe(700);
  });
});

describe('data quality labels', () => {
  const ok = { value: 1, storedAt: 1, stale: false };
  it('never says LIVE unless real-time is confirmed', () => {
    expect(qualityFor(ok, 'OPEN', false)).toBe('DELAYED');
    expect(qualityFor(ok, 'OPEN', true)).toBe('LIVE');
    expect(qualityFor(ok, 'CLOSED', true)).toBe('EOD');
    expect(qualityFor({ ...ok, stale: true }, 'OPEN', false)).toBe('STALE');
    expect(qualityFor({ value: null, storedAt: null, stale: false }, 'OPEN', false)).toBe('UNAVAILABLE');
  });
  it('knows the Casablanca session (follows the IANA Africa/Casablanca offset)', () => {
    // Build UTC instants for a given Casablanca wall-clock time, whatever the official offset is.
    const at = (day: string, hh: number, mm: number) => {
      const guess = new Date(`${day}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00Z`);
      const p = casablancaParts(guess);
      const offsetMin = p.minutes - (hh * 60 + mm);
      return new Date(guess.getTime() - offsetMin * 60000);
    };
    expect(marketPhase(at('2026-11-11', 11, 0))).toBe('OPEN');      // Wednesday
    expect(marketPhase(at('2026-11-11', 9, 10))).toBe('PRE_OPEN');
    expect(marketPhase(at('2026-11-11', 15, 45))).toBe('CLOSED');
    expect(marketPhase(at('2026-11-14', 11, 0))).toBe('CLOSED');    // Saturday
  });
  it('attributes weekend data to Friday', () => {
    expect(HistoryService.sessionFor(new Date('2026-11-14T10:00:00Z'))).toEqual({ date: '2026-11-13', complete: true });
  });
});

describe('OanorApiService against a local stub of the documented API', () => {
  let server: Server;
  const seen: { url: string; key?: string }[] = [];
  let svc: OanorApiService;
  beforeAll(async () => {
    server = createServer((req, res) => {
      seen.push({ url: req.url!, key: req.headers['x-oanor-key'] as string });
      const body = req.url!.startsWith('/v1/quote') ? quote : req.url!.startsWith('/v1/screener') ? screener : index;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(body));
    });
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as AddressInfo).port;
    const cfg = new ConfigService({ OANOR_API_KEY: 'test-key', OANOR_BASE_URL: `http://127.0.0.1:${port}`, OANOR_MIN_INTERVAL_MS: 50 });
    svc = new OanorApiService(cfg);
  });
  afterAll(() => server.close());

  it('sends the key header, batches tickers and respects spacing', async () => {
    const t0 = Date.now();
    const [q, s] = await Promise.all([svc.quote(['ATW', 'IAM']), svc.screener('marketcap', 100)]);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(45);
    expect(q.data.quotes).toHaveLength(2);
    expect(s.data.results.length).toBeGreaterThan(0);
    expect(seen[0]).toEqual({ url: '/v1/quote?codes=ATW,IAM', key: 'test-key' });
    expect(seen[1].url).toBe('/v1/screener?by=marketcap&limit=100');
    expect(svc.usage().callsThisMonth).toBe(2);
  });
  it('refuses more than 20 tickers per call', () => {
    expect(() => svc.quote(Array.from({ length: 21 }, (_, i) => `T${i}`))).toThrow();
  });
});
