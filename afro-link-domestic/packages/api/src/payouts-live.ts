import { createHmac } from 'node:crypto';
import {
  AdvanceChannel,
  PayoutAdapter,
  PayoutRequest,
  PayoutResult,
} from '@afro-link/shared';
import { SimulatedPayoutAdapter } from './payouts';

const DEFAULT_TIMEOUT_MS = 15_000;

export interface TelebirrConfig {
  appId: string;
  appKey: string;
  shortCode?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

export interface CbeBirrConfig {
  clientId: string;
  clientSecret: string;
  baseUrl: string;
  timeoutMs?: number;
}

interface HttpResult {
  ok: boolean;
  status: number;
  json: unknown;
  error?: string;
}

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number,
): Promise<HttpResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const json = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, json };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      json: null,
      error: err instanceof Error ? err.message : 'network error',
    };
  } finally {
    clearTimeout(timer);
  }
}

function referenceOf(json: unknown, depth = 0): string | undefined {
  if (typeof json !== 'object' || json === null || depth > 3) return undefined;
  const record = json as Record<string, unknown>;
  for (const key of ['transactionId', 'transaction_id', 'reference', 'tradeNo', 'outTradeNo', 'txnRef']) {
    const value = record[key];
    if (typeof value === 'string' && value !== '') return value;
  }
  return referenceOf(record.data, depth + 1) ?? referenceOf(record.result, depth + 1);
}

function hmacHex(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export class TelebirrGateway implements PayoutAdapter {
  constructor(private readonly config: TelebirrConfig) {}

  async disburse(request: PayoutRequest): Promise<PayoutResult> {
    return this.send(
      '/apiaccess/payment/gateway/payment/v1/b2c',
      request,
      'AFRO_LINK_FUEL_ADVANCE',
      'TB',
    );
  }

  async recover(request: PayoutRequest): Promise<PayoutResult> {
    return this.send(
      '/apiaccess/payment/gateway/payment/v1/collection',
      request,
      'AFRO_LINK_ADVANCE_RECOVERY',
      'TB',
    );
  }

  private async send(
    path: string,
    request: PayoutRequest,
    subject: string,
    prefix: string,
  ): Promise<PayoutResult> {
    const baseUrl = this.config.baseUrl ?? 'https://app.ethiomobilemoney.et:2121';
    const body = {
      appId: this.config.appId,
      shortCode: this.config.shortCode,
      subject,
      outTradeNo: `${subject}:${request.advanceId}`,
      amount: request.amountEtb.toFixed(2),
      msisdn: request.phone,
      nonce: crypto.randomUUID(),
      timestamp: Date.now(),
    };
    const payload = JSON.stringify(body);
    const res = await postJson(
      `${baseUrl}${path}`,
      {
        'X-App-Id': this.config.appId,
        'X-Signature': hmacHex(this.config.appKey, payload),
      },
      body,
      this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );
    if (!res.ok) {
      return {
        success: false,
        error: `telebirr gateway error (HTTP ${res.status}${res.error ? `: ${res.error}` : ''})`,
      };
    }
    const reference = referenceOf(res.json);
    if (!reference) {
      return { success: false, error: 'telebirr gateway returned no transaction reference' };
    }
    return { success: true, reference: `${prefix}-${reference}` };
  }
}

export class CbeBirrGateway implements PayoutAdapter {
  constructor(private readonly config: CbeBirrConfig) {}

  async disburse(request: PayoutRequest): Promise<PayoutResult> {
    return this.send('b2c', request, 'CBE');
  }

  async recover(request: PayoutRequest): Promise<PayoutResult> {
    return this.send('collection', request, 'CBE');
  }

  private async send(
    command: string,
    request: PayoutRequest,
    prefix: string,
  ): Promise<PayoutResult> {
    const body = {
      command,
      clientReference: `${command}:${request.advanceId}`,
      account: request.phone,
      amount: request.amountEtb.toFixed(2),
      requestId: crypto.randomUUID(),
      timestamp: Date.now(),
    };
    const payload = JSON.stringify(body);
    const res = await postJson(
      `${this.config.baseUrl.replace(/\/$/, '')}/${command}`,
      {
        'X-Client-Id': this.config.clientId,
        'X-Signature': hmacHex(this.config.clientSecret, payload),
      },
      body,
      this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );
    if (!res.ok) {
      return {
        success: false,
        error: `cbe_birr gateway error (HTTP ${res.status}${res.error ? `: ${res.error}` : ''})`,
      };
    }
    const reference = referenceOf(res.json);
    if (!reference) {
      return { success: false, error: 'cbe_birr gateway returned no transaction reference' };
    }
    return { success: true, reference: `${prefix}-${reference}` };
  }
}

export function payoutAdaptersFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): Record<AdvanceChannel, PayoutAdapter> {
  const telebirr =
    env.TELEBIRR_APP_ID && env.TELEBIRR_APP_KEY
      ? new TelebirrGateway({
          appId: env.TELEBIRR_APP_ID,
          appKey: env.TELEBIRR_APP_KEY,
          shortCode: env.TELEBIRR_SHORT_CODE,
          baseUrl: env.TELEBIRR_BASE_URL,
          timeoutMs: env.TELEBIRR_TIMEOUT_MS ? Number(env.TELEBIRR_TIMEOUT_MS) : undefined,
        })
      : new SimulatedPayoutAdapter('telebirr');

  let cbe: PayoutAdapter = new SimulatedPayoutAdapter('cbe_birr');
  if (env.CBE_BIRR_CLIENT_ID && env.CBE_BIRR_CLIENT_SECRET) {
    if (!env.CBE_BIRR_BASE_URL) {
      throw new Error('CBE_BIRR_BASE_URL is required when CBE Birr credentials are set.');
    }
    cbe = new CbeBirrGateway({
      clientId: env.CBE_BIRR_CLIENT_ID,
      clientSecret: env.CBE_BIRR_CLIENT_SECRET,
      baseUrl: env.CBE_BIRR_BASE_URL,
      timeoutMs: env.CBE_BIRR_TIMEOUT_MS ? Number(env.CBE_BIRR_TIMEOUT_MS) : undefined,
    });
  }

  return { telebirr, cbe_birr: cbe };
}
