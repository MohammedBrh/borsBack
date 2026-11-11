import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'fs';
import { dirname } from 'path';
import { casablancaParts, sessionClosedToday } from './market-hours';
import { DailyBar } from './models';

type Store = Record<string, DailyBar[]>;
const MAX_BARS = 260;

/**
 * The free provider has no historical endpoint. This service records the daily
 * bars the app itself observes (one bar per symbol per session) so that, over
 * time, genuine history is available for charts and swing support/resistance.
 * Nothing is back-filled or synthesized.
 */
@Injectable()
export class HistoryService implements OnModuleInit {
  private readonly log = new Logger(HistoryService.name);
  private store: Store = {};
  private file: string;
  private writeTimer: NodeJS.Timeout | null = null;

  constructor(config: ConfigService) {
    this.file = config.get<string>('HISTORY_FILE') ?? './data/history.json';
  }

  async onModuleInit() {
    try {
      this.store = JSON.parse(await fs.readFile(this.file, 'utf8'));
      this.log.log(`Loaded history for ${Object.keys(this.store).length} symbols from ${this.file}`);
    } catch {
      this.store = {};
      this.log.log(`No history file yet (${this.file}); it will be created on the first capture.`);
    }
  }

  /** Date of the session the provider values belong to, plus whether it is finished. */
  static sessionFor(now = new Date()): { date: string; complete: boolean } {
    const { weekday, minutes } = casablancaParts(now);
    const weekend = weekday === 'Sat' || weekday === 'Sun';
    if (!weekend && minutes >= 9 * 60 + 30) {
      return { date: casablancaParts(now).date, complete: sessionClosedToday(now) };
    }
    // Before today's open or on a weekend: values are from the previous weekday.
    const d = new Date(now.getTime());
    do { d.setUTCDate(d.getUTCDate() - 1); } while (['Sat', 'Sun'].includes(casablancaParts(d).weekday));
    return { date: casablancaParts(d).date, complete: true };
  }

  record(symbol: string, bar: Omit<DailyBar, 'date' | 'complete' | 'capturedAt'>, now = new Date()) {
    if (bar.close === null) return;
    const { date, complete } = HistoryService.sessionFor(now);
    const bars = (this.store[symbol] ??= []);
    const last = bars[bars.length - 1];
    // Public holiday: provider repeats the previous session; don't create a fake new day.
    if (last && last.date !== date && last.complete &&
        last.close === bar.close && last.high === bar.high && last.low === bar.low && last.volume === bar.volume) {
      return;
    }
    const entry: DailyBar = { date, ...bar, complete, capturedAt: now.toISOString() };
    if (last && last.date === date) {
      if (last.complete && !complete) return;
      bars[bars.length - 1] = entry;
    } else if (!last || last.date < date) {
      bars.push(entry);
    } else {
      return; // older than what we have; ignore
    }
    if (bars.length > MAX_BARS) bars.splice(0, bars.length - MAX_BARS);
    this.scheduleWrite();
  }

  bars(symbol: string): DailyBar[] {
    return [...(this.store[symbol] ?? [])];
  }

  hasCompleteBar(symbol: string, date: string): boolean {
    return (this.store[symbol] ?? []).some((b) => b.date === date && b.complete);
  }

  stats() {
    const symbols = Object.keys(this.store);
    const lengths = symbols.map((s) => this.store[s].length);
    return {
      file: this.file,
      symbols: symbols.length,
      maxSessions: lengths.length ? Math.max(...lengths) : 0,
      firstDate: symbols.length ? symbols.map((s) => this.store[s][0]?.date).sort()[0] : null,
    };
  }

  private scheduleWrite() {
    if (this.writeTimer) return;
    this.writeTimer = setTimeout(async () => {
      this.writeTimer = null;
      try {
        await fs.mkdir(dirname(this.file), { recursive: true });
        await fs.writeFile(this.file, JSON.stringify(this.store));
      } catch (e) {
        this.log.error(`Could not write ${this.file}: ${(e as Error).message}`);
      }
    }, 2000);
  }
}
