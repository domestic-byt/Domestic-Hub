import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CbeBirrGateway,
  TelebirrGateway,
  payoutAdaptersFromEnv,
} from '../src/payouts-live';
import { SimulatedPayoutAdapter } from '../src/payouts';
import { PayoutRequest } from '@afro-link/shared';

const request: PayoutRequest = {
  advanceId: 'adv-1',
  operatorId: 'op-1',
  amountEtb: 5000,
  phone: '+251911000000',
  channel: 'telebirr',
};

type FetchMock = ReturnType<typeof vi.fn>;

function stubFetch(impl: FetchMock) {
  vi.stubGlobal('fetch', impl);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TelebirrGateway', () => {
  it('disburses and extracts the transaction reference', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ transactionId: 'TBX-9001' }), { status: 200 }),
    );
    stubFetch(fetchMock);

    const gateway = new TelebirrGateway({ appId: 'app', appKey: 'key' });
    const result = await gateway.disburse(request);

    expect(result).toEqual({ success: true, reference: 'TB-TBX-9001' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://app.ethiomobilemoney.et:2121/apiaccess/payment/gateway/payment/v1/b2c');
    const body = JSON.parse(init.body as string);
    expect(body.msisdn).toBe(request.phone);
    expect(body.amount).toBe('5000.00');
    expect((init.headers as Record<string, string>)['X-App-Id']).toBe('app');
    expect((init.headers as Record<string, string>)['X-Signature']).toBeTruthy();
  });

  it('recovers through the collection endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { tradeNo: 'RCV-77' } }), { status: 200 }),
    );
    stubFetch(fetchMock);

    const result = await new TelebirrGateway({ appId: 'app', appKey: 'key' }).recover(request);
    expect(result).toEqual({ success: true, reference: 'TB-RCV-77' });
    expect(fetchMock.mock.calls[0]![0]).toContain('/v1/collection');
  });

  it('maps HTTP errors to failed payouts', async () => {
    stubFetch(vi.fn().mockResolvedValue(new Response('{"error":"insufficient float"}', { status: 502 })));
    const result = await new TelebirrGateway({ appId: 'app', appKey: 'key' }).disburse(request);
    expect(result).toEqual({ success: false, error: expect.stringContaining('HTTP 502') });
  });

  it('maps network failures and timeouts to failed payouts', async () => {
    stubFetch(vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    const result = await new TelebirrGateway({ appId: 'app', appKey: 'key' }).disburse(request);
    expect(result.success).toBe(false);
    expect(result.error).toContain('HTTP 0');
  });

  it('aborts slow gateways via the timeout signal', async () => {
    stubFetch(
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal!.addEventListener('abort', () => reject(new Error('The operation was aborted')));
          }),
      ),
    );
    const result = await new TelebirrGateway({ appId: 'app', appKey: 'key', timeoutMs: 20 }).disburse(request);
    expect(result.success).toBe(false);
  });

  it('fails when the gateway returns no reference', async () => {
    stubFetch(vi.fn().mockResolvedValue(new Response('{"status":"ok"}', { status: 200 })));
    const result = await new TelebirrGateway({ appId: 'app', appKey: 'key' }).disburse(request);
    expect(result).toEqual({
      success: false,
      error: 'telebirr gateway returned no transaction reference',
    });
  });
});

describe('CbeBirrGateway', () => {
  it('disburses and extracts the reference', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ reference: 'CBE-1' }), { status: 200 }),
    );
    stubFetch(fetchMock);

    const gateway = new CbeBirrGateway({
      clientId: 'client',
      clientSecret: 'secret',
      baseUrl: 'https://gateway.example/',
    });
    const result = await gateway.disburse({ ...request, channel: 'cbe_birr' });

    expect(result).toEqual({ success: true, reference: 'CBE-CBE-1' });
    expect(fetchMock.mock.calls[0]![0]).toBe('https://gateway.example/b2c');
  });

  it('maps gateway errors to failed payouts', async () => {
    stubFetch(vi.fn().mockResolvedValue(new Response('{}', { status: 500 })));
    const gateway = new CbeBirrGateway({
      clientId: 'client',
      clientSecret: 'secret',
      baseUrl: 'https://gateway.example',
    });
    const result = await gateway.recover({ ...request, channel: 'cbe_birr' });
    expect(result).toEqual({ success: false, error: expect.stringContaining('HTTP 500') });
  });
});

describe('payoutAdaptersFromEnv', () => {
  it('falls back to simulated adapters without credentials', () => {
    const adapters = payoutAdaptersFromEnv({});
    expect(adapters.telebirr).toBeInstanceOf(SimulatedPayoutAdapter);
    expect(adapters.cbe_birr).toBeInstanceOf(SimulatedPayoutAdapter);
  });

  it('builds live gateways when credentials are present', () => {
    const adapters = payoutAdaptersFromEnv({
      TELEBIRR_APP_ID: 'app',
      TELEBIRR_APP_KEY: 'key',
      CBE_BIRR_CLIENT_ID: 'client',
      CBE_BIRR_CLIENT_SECRET: 'secret',
      CBE_BIRR_BASE_URL: 'https://gateway.example',
    });
    expect(adapters.telebirr).toBeInstanceOf(TelebirrGateway);
    expect(adapters.cbe_birr).toBeInstanceOf(CbeBirrGateway);
  });

  it('refuses CBE credentials without a base URL', () => {
    expect(() =>
      payoutAdaptersFromEnv({ CBE_BIRR_CLIENT_ID: 'client', CBE_BIRR_CLIENT_SECRET: 'secret' }),
    ).toThrow(/CBE_BIRR_BASE_URL/);
  });
});
