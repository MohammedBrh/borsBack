import { ConfigService } from '@nestjs/config';
import { marketPhase } from './market-hours';

export function ttlMs(config: ConfigService): number {
  const session = Number(config.get('CACHE_TTL_SESSION_S') ?? 600);
  const closed = Number(config.get('CACHE_TTL_CLOSED_S') ?? 3600);
  return (marketPhase() === 'OPEN' ? session : closed) * 1000;
}

export function confirmedRealtime(config: ConfigService): boolean {
  return String(config.get('OANOR_CONFIRMED_REALTIME') ?? 'false') === 'true';
}
