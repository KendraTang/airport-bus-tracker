import { BUDGET } from '../config.ts';
import { taipeiIso, taipeiParts } from '../time.ts';
import { assertWithinBudget, recordUsage, type Service } from './usage.ts';

const TOKEN_URL = 'https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token';
const BASE_URL: Record<Exclude<Service, 'auth'>, string> = {
  basic: 'https://tdx.transportdata.tw/api/basic',
  historical: 'https://tdx.transportdata.tw/api/historical',
};
// Reserve room for a typical response when checking the budget before a call.
const EXPECTED_BYTES: Record<Exclude<Service, 'auth'>, number> = { basic: 5_000, historical: 2_000_000 };

export type TdxResponse = {
  fetchedAt: string;
  status: number;
  bytes: number;
  rateLimitRemaining: number | null;
  text: string;
};

export class TdxClient {
  private token: { value: string; expiresAt: number } | null = null;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly source: string;
  private readonly dataDir: string;

  constructor(opts: { clientId: string; clientSecret: string; source: string; dataDir: string }) {
    this.clientId = opts.clientId;
    this.clientSecret = opts.clientSecret;
    this.source = opts.source;
    this.dataDir = opts.dataDir;
  }

  private async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt) return this.token.value;
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }),
    });
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    const now = new Date();
    recordUsage(this.dataDir, taipeiParts(now).month, {
      at: taipeiIso(now),
      source: this.source,
      service: 'auth',
      path: '/auth/token',
      status: res.status,
      bytes: 0,
    });
    if (!res.ok || !body.access_token) throw new Error(`TDX token request failed: HTTP ${res.status}`);
    // Refresh 10 minutes early so a long run never sends an expired token.
    this.token = { value: body.access_token, expiresAt: Date.now() + ((body.expires_in ?? 3600) - 600) * 1000 };
    return this.token.value;
  }

  async get(service: Exclude<Service, 'auth'>, path: string): Promise<TdxResponse> {
    const now = new Date();
    const month = taipeiParts(now).month;
    assertWithinBudget(this.dataDir, month, { service, bytes: EXPECTED_BYTES[service] }, BUDGET);

    const token = await this.accessToken();
    const res = await fetch(BASE_URL[service] + path, {
      headers: { authorization: `Bearer ${token}`, 'accept-encoding': 'gzip' },
    });
    const text = await res.text();
    const bytes = Buffer.byteLength(text);
    recordUsage(this.dataDir, month, { at: taipeiIso(now), source: this.source, service, path, status: res.status, bytes });

    const remaining = res.headers.get('x-ratelimit-remaining-minute');
    return {
      fetchedAt: taipeiIso(now),
      status: res.status,
      bytes,
      rateLimitRemaining: remaining === null ? null : Number(remaining),
      text,
    };
  }
}
