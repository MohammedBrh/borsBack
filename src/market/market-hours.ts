import { MarketPhase } from './models';

/**
 * Casablanca Stock Exchange regular session (Africa/Casablanca time):
 * pre-open 09:00-09:30, continuous trading 09:30-15:30, Monday-Friday.
 * Public holidays and Ramadan schedules are NOT modelled; on those days the
 * provider simply returns the last session's values, which we label EOD.
 */
const TZ = 'Africa/Casablanca';

export function casablancaParts(now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
  });
  const p = Object.fromEntries(fmt.formatToParts(now).map((x) => [x.type, x.value]));
  const hour = Number(p.hour) % 24;
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    weekday: p.weekday as string,
    minutes: hour * 60 + Number(p.minute),
  };
}

export function marketPhase(now = new Date()): MarketPhase {
  const { weekday, minutes } = casablancaParts(now);
  if (weekday === 'Sat' || weekday === 'Sun') return 'CLOSED';
  if (minutes >= 9 * 60 && minutes < 9 * 60 + 30) return 'PRE_OPEN';
  if (minutes >= 9 * 60 + 30 && minutes < 15 * 60 + 30) return 'OPEN';
  return 'CLOSED';
}

/** True when "now" is after today's close (so today's bar is final). */
export function sessionClosedToday(now = new Date()): boolean {
  const { weekday, minutes } = casablancaParts(now);
  if (weekday === 'Sat' || weekday === 'Sun') return true;
  return minutes >= 15 * 60 + 30;
}
