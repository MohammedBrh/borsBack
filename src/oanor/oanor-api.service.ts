import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError, AxiosInstance } from 'axios';
import {
  OanorEnvelope, OanorIndexData, OanorMetaData, OanorQuoteData, OanorScreenerData,
} from './oanor.types';

export class UpstreamError extends Error {
  constructor(message: string, readonly status?: number) { super(message); }
}

/**
 * Only class that talks to api.oanor.com.
 * - API key stays server-side (header x-oanor-key)
 * - requests are serialized and spaced (free plan: 2 req/s)
 * - a monthly budget stops calls before the provider's hard cap (HTTP 429)
 * - a 429 with Retry-After pauses all calls for that duration
 */
@Injectable()
export class OanorApiService {
  private readonly log = new Logger(OanorApiService.name);
  private readonly http: AxiosInstance;
  private readonly minIntervalMs: number;
  private readonly monthlyBudget: number;
  private queue: Promise<unknown> = Promise.resolve();
  private lastCallAt = 0;
  private cooldownUntil = 0;
  private month = new Date().toISOString().slice(0, 7);
  private callsThisMonth = 0;
  private lastError: { at: string; message: string; status?: number } | null = null;
  private lastSuccessAt: string | null = null;

  constructor(private readonly config: ConfigService) {
    const key = this.config.get<string>('OANOR_API_KEY') ?? '';
    this.minIntervalMs = Number(this.config.get('OANOR_MIN_INTERVAL_MS') ?? 600);
    this.monthlyBudget = Number(this.config.get('OANOR_MONTHLY_BUDGET') ?? 7500);
    this.http = axios.create({
      baseURL: this.config.get('OANOR_BASE_URL') ?? 'https://api.oanor.com/casablanca-stock-api',
      timeout: Number(this.config.get('OANOR_TIMEOUT_MS') ?? 8000),
      headers: { 'x-oanor-key': key, Accept: 'application/json' },
    });
    if (!key) this.log.warn('OANOR_API_KEY is empty: every upstream call will fail with 401.');
  }

  get hasKey(): boolean {
    return !!this.config.get<string>('OANOR_API_KEY');
  }

  quote(codes: string[]) {
    if (codes.length === 0 || codes.length > 20) {
      throw new UpstreamError('quote accepts 1 to 20 tickers per call');
    }
    return this.get<OanorQuoteData>('/v1/quote', { codes: codes.join(',') });
  }

  screener(by: OanorScreenerData['by'], limit = 100) {
    return this.get<OanorScreenerData>('/v1/screener', { by, limit: String(Math.min(100, Math.max(1, limit))) });
  }

  index(name = 'MASI') {
    return this.get<OanorIndexData>('/v1/index', { name });
  }

  meta() {
    return this.get<OanorMetaData>('/v1/meta');
  }

  usage() {
    this.rollMonth();
    return {
      month: this.month,
      callsThisMonth: this.callsThisMonth,
      monthlyBudget: this.monthlyBudget,
      cooldownUntil: this.cooldownUntil > Date.now() ? new Date(this.cooldownUntil).toISOString() : null,
      lastSuccessAt: this.lastSuccessAt,
      lastError: this.lastError,
      note: 'Call counter is in-memory and resets when the backend restarts.',
    };
  }

  private rollMonth() {
    const m = new Date().toISOString().slice(0, 7);
    if (m !== this.month) { this.month = m; this.callsThisMonth = 0; }
  }

  /** Serializes calls so the configured spacing is respected even under concurrency. */
  private get<T>(path: string, params?: Record<string, string>): Promise<OanorEnvelope<T>> {
    const run = async () => {
      this.rollMonth();
      if (!this.hasKey) throw new UpstreamError('OANOR_API_KEY is not configured', 401);
      if (Date.now() < this.cooldownUntil) {
        throw new UpstreamError(`Provider rate limit: paused until ${new Date(this.cooldownUntil).toISOString()}`, 429);
      }
      if (this.callsThisMonth >= this.monthlyBudget) {
        throw new UpstreamError(`Monthly call budget reached (${this.monthlyBudget}); serving cache only`, 429);
      }
      const wait = this.lastCallAt + this.minIntervalMs - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.lastCallAt = Date.now();
      this.callsThisMonth++;
      const started = Date.now();
      try {
        const res = await this.http.get<OanorEnvelope<T>>(path, { params });
        if (!res.data?.success) throw new UpstreamError(res.data?.message || 'Provider returned success=false');
        this.lastSuccessAt = new Date().toISOString();
        this.log.log(`GET ${path} ${JSON.stringify(params ?? {})} -> ${res.status} in ${Date.now() - started} ms`);
        return res.data;
      } catch (e) {
        const err = this.toUpstreamError(e);
        this.lastError = { at: new Date().toISOString(), message: err.message, status: err.status };
        this.log.error(`GET ${path} failed: ${err.message}`);
        throw err;
      }
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }

  private toUpstreamError(e: unknown): UpstreamError {
    if (e instanceof UpstreamError) return e;
    const ax = e as AxiosError;
    if (ax.code === 'ECONNABORTED') return new UpstreamError('Provider request timed out');
    const status = ax.response?.status;
    switch (status) {
      case 401: return new UpstreamError('Missing, invalid or expired API key', 401);
      case 402: return new UpstreamError('No active Oanor subscription for this API', 402);
      case 403: return new UpstreamError('API key not allowed for this API', 403);
      case 429: {
        const retry = Number(ax.response?.headers?.['retry-after'] ?? 60);
        this.cooldownUntil = Date.now() + (Number.isFinite(retry) ? retry : 60) * 1000;
        return new UpstreamError('Provider rate limit or quota reached', 429);
      }
      default:
        if (status && status >= 500) return new UpstreamError(`Provider upstream error (${status})`, status);
        return new UpstreamError(ax.message || 'Network error contacting provider', status);
    }
  }
}
