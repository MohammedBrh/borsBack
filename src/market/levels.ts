import { DailyBar, Level, LevelsResult, MarketPhase, Stock } from './models';
import { round } from './quality';

/**
 * Support / resistance ("plancher / plafond") for one stock.
 *
 * 1. Classic floor pivots, from the last COMPLETED session's high, low, close:
 *      P  = (H + L + C) / 3
 *      R1 = 2P - L        S1 = 2P - H
 *      R2 = P + (H - L)   S2 = P - (H - L)
 *      R3 = H + 2(P - L)  S3 = L - 2(H - P)
 * 2. Fibonacci pivots: P +/- 0.382, 0.618, 1.000 x (H - L).
 * 3. Intraday: today's high and low (the levels the market actually tested),
 *    the open and the previous close.
 * 4. Swing levels from the daily bars this app has recorded: the 20-session
 *    high/low and recent fractal swing points (a high/low not exceeded by the
 *    two sessions on each side). Requires at least 10 recorded sessions.
 *
 * A level's role depends on where the price is: anything above the current
 * price is labelled resistance, anything below is support (an R1 that has been
 * broken becomes support).
 */
export function computeLevels(stock: Stock, bars: DailyBar[], phase: MarketPhase, sessionDate: string): LevelsResult {
  const price = stock.price;
  const notes: string[] = [];
  const mk = (label: string, p: number | null, method: Level['method'], forcePivot = false): Level | null => {
    if (p === null || !Number.isFinite(p)) return null;
    const v = round(p, 2) as number;
    return {
      label, price: v, method,
      kind: forcePivot ? 'pivot' : price === null ? (label.startsWith('R') ? 'resistance' : 'support') : v > price ? 'resistance' : 'support',
      distancePercent: price ? round(((v - price) / price) * 100, 2) : null,
    };
  };

  const complete = bars.filter((b) => b.complete && b.high !== null && b.low !== null && b.close !== null);

  // ---- choose the session the pivots are based on
  let basis: LevelsResult['basis'] = null;
  const sessionFinished = phase !== 'OPEN' && stock.high !== null && stock.low !== null && price !== null;
  if (sessionFinished) {
    basis = { session: 'previous-complete', date: sessionDate, high: stock.high!, low: stock.low!, close: price! };
    notes.push(`Pivots use the completed session of ${sessionDate}; they apply to the next session.`);
  } else {
    const prev = [...complete].reverse().find((b) => b.date < sessionDate);
    if (prev) {
      basis = { session: 'previous-complete', date: prev.date, high: prev.high!, low: prev.low!, close: prev.close! };
      notes.push(`Pivots use the completed session of ${prev.date} recorded by this app.`);
    } else if (stock.high !== null && stock.low !== null && price !== null) {
      basis = { session: 'current-provisional', date: sessionDate, high: stock.high, low: stock.low, close: price };
      notes.push('No completed previous session recorded yet: pivots are provisional, computed from the session in progress, and will move until the close.');
    } else {
      notes.push('High/low not available from the provider: pivots cannot be computed.');
    }
  }

  let pivot: number | null = null;
  const classic: Level[] = [];
  const fibonacci: Level[] = [];
  if (basis) {
    const { high: H, low: L, close: C } = basis;
    const P = (H + L + C) / 3;
    const range = H - L;
    pivot = round(P, 2);
    const add = (arr: Level[], l: Level | null) => l && arr.push(l);
    add(classic, mk('R3', H + 2 * (P - L), 'pivot-classic'));
    add(classic, mk('R2', P + range, 'pivot-classic'));
    add(classic, mk('R1', 2 * P - L, 'pivot-classic'));
    add(classic, mk('P', P, 'pivot-classic', true));
    add(classic, mk('S1', 2 * P - H, 'pivot-classic'));
    add(classic, mk('S2', P - range, 'pivot-classic'));
    add(classic, mk('S3', L - 2 * (H - P), 'pivot-classic'));
    add(fibonacci, mk('R3', P + range, 'pivot-fibonacci'));
    add(fibonacci, mk('R2', P + 0.618 * range, 'pivot-fibonacci'));
    add(fibonacci, mk('R1', P + 0.382 * range, 'pivot-fibonacci'));
    add(fibonacci, mk('P', P, 'pivot-fibonacci', true));
    add(fibonacci, mk('S1', P - 0.382 * range, 'pivot-fibonacci'));
    add(fibonacci, mk('S2', P - 0.618 * range, 'pivot-fibonacci'));
    add(fibonacci, mk('S3', P - range, 'pivot-fibonacci'));
    if (range === 0) notes.push('High equals low for that session (very thin trading): pivot levels collapse onto one price.');
  }

  const intraday = [
    mk('Day high', stock.high, 'intraday'),
    mk('Open', stock.open, 'intraday'),
    mk('Previous close', stock.previousClose, 'intraday'),
    mk('Day low', stock.low, 'intraday'),
  ].filter((l): l is Level => !!l).sort((a, b) => b.price - a.price);

  // ---- swing levels from recorded history
  const swing: Level[] = [];
  if (complete.length >= 10) {
    const last20 = complete.slice(-20);
    swing.push(mk(`${last20.length}-session high`, Math.max(...last20.map((b) => b.high!)), 'swing')!);
    swing.push(mk(`${last20.length}-session low`, Math.min(...last20.map((b) => b.low!)), 'swing')!);
    const win = complete.slice(-60);
    const highs: number[] = [];
    const lows: number[] = [];
    for (let i = 2; i < win.length - 2; i++) {
      const n = [win[i - 2], win[i - 1], win[i + 1], win[i + 2]];
      if (n.every((b) => b.high! <= win[i].high!)) highs.push(win[i].high!);
      if (n.every((b) => b.low! >= win[i].low!)) lows.push(win[i].low!);
    }
    if (price !== null) {
      highs.filter((h) => h > price).sort((a, b) => a - b).slice(0, 2)
        .forEach((h, i) => swing.push(mk(`Swing high ${i + 1}`, h, 'swing')!));
      lows.filter((l) => l < price).sort((a, b) => b - a).slice(0, 2)
        .forEach((l, i) => swing.push(mk(`Swing low ${i + 1}`, l, 'swing')!));
    }
    swing.sort((a, b) => b.price - a.price);
  } else {
    notes.push(`Swing levels need at least 10 completed sessions recorded by this app (currently ${complete.length}). The provider's free plan has no price history.`);
  }

  const all = [...classic, ...fibonacci, ...intraday, ...swing].filter((l) => l.kind !== 'pivot' || price !== null);
  let nearestResistance: Level | null = null;
  let nearestSupport: Level | null = null;
  if (price !== null) {
    for (const l of all) {
      if (l.price > price && (!nearestResistance || l.price < nearestResistance.price)) nearestResistance = { ...l, kind: 'resistance' };
      if (l.price < price && (!nearestSupport || l.price > nearestSupport.price)) nearestSupport = { ...l, kind: 'support' };
    }
  }
  notes.push('Levels are mechanical reference points, not forecasts or investment advice.');

  return {
    symbol: stock.symbol, price, basis, pivot, classic, fibonacci, intraday, swing,
    nearestResistance, nearestSupport, historySessions: complete.length, notes,
  };
}
