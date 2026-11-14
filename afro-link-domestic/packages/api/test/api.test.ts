import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PayoutAdapter, PayoutRequest, PayoutResult } from '@afro-link/shared';
import { buildServer } from '../src/server';

const addis = { name: 'Addis Ababa', lat: 9.03, lon: 38.74 };
const jimma = { name: 'Jimma', lat: 7.67, lon: 36.83 };

describe('marketplace api', async () => {
  const app = await buildServer();

  beforeAll(async () => {
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports health', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      status: 'ok',
      service: 'afro-link-domestic-api',
      domain: 'afro-link.domestic.com.et',
    });
  });

  it('allows CORS from the production domain and blocks unknown origins', async () => {
    const allowed = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://afro-link.domestic.com.et' },
    });
    expect(allowed.headers['access-control-allow-origin']).toBe('https://afro-link.domestic.com.et');

    const blocked = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://evil.example' },
    });
    expect(blocked.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('runs the full shipper-to-invoice flow', async () => {
    const operatorRes = await app.inject({
      method: 'POST',
      url: '/operators',
      payload: {
        name: 'Abebe Trucks',
        phone: '+251911000000',
        truckPlate: 'AA-12345',
        capacityTons: 25,
        currentCity: addis,
        lastDropOffCity: jimma,
      },
    });
    expect(operatorRes.statusCode).toBe(201);
    const operator = operatorRes.json();

    const loadRes = await app.inject({
      method: 'POST',
      url: '/loads',
      payload: {
        shipperId: 'shipper-1',
        origin: jimma,
        destination: addis,
        weightTons: 20,
        offeredPriceEtb: 40000,
      },
    });
    expect(loadRes.statusCode).toBe(201);
    const load = loadRes.json();

    const matchesRes = await app.inject({ method: 'GET', url: `/loads/${load.id}/matches` });
    expect(matchesRes.statusCode).toBe(200);
    const matches = matchesRes.json();
    expect(matches).toHaveLength(1);
    expect(matches[0].operatorId).toBe(operator.id);
    expect(matches[0].deadheadKm).toBe(0);

    const shipmentRes = await app.inject({
      method: 'POST',
      url: '/shipments',
      payload: { loadId: load.id, operatorId: operator.id },
    });
    expect(shipmentRes.statusCode).toBe(201);
    const shipment = shipmentRes.json();
    expect(shipment.deadheadKm).toBe(0);

    const earlyInvoice = await app.inject({
      method: 'POST',
      url: '/invoices',
      payload: { shipmentId: shipment.id, shipperTin: '0011223345', operatorTin: '0099887766' },
    });
    expect(earlyInvoice.statusCode).toBe(409);

    const advanceRes = await app.inject({
      method: 'POST',
      url: '/advances',
      payload: {
        operatorId: operator.id,
        shipmentId: shipment.id,
        amountEtb: 8000,
        channel: 'telebirr',
      },
    });
    expect(advanceRes.statusCode).toBe(201);
    const advance = advanceRes.json();

    const earlyDisburseRes = await app.inject({
      method: 'POST',
      url: `/advances/${advance.id}/transition`,
      payload: { action: 'disburse' },
    });
    expect(earlyDisburseRes.statusCode).toBe(409);

    const approveRes = await app.inject({
      method: 'POST',
      url: `/advances/${advance.id}/transition`,
      payload: { action: 'approve' },
    });
    expect(approveRes.statusCode).toBe(200);
    expect(approveRes.json().status).toBe('approved');

    const disburseRes = await app.inject({
      method: 'POST',
      url: `/advances/${advance.id}/transition`,
      payload: { action: 'disburse' },
    });
    expect(disburseRes.statusCode).toBe(200);
    expect(disburseRes.json().status).toBe('disbursed');
    expect(disburseRes.json().payoutReference).toMatch(/^TB-SIM-/);

    const secondAdvance = await app.inject({
      method: 'POST',
      url: '/advances',
      payload: {
        operatorId: operator.id,
        shipmentId: shipment.id,
        amountEtb: 1000,
        channel: 'cbe_birr',
      },
    });
    expect(secondAdvance.statusCode).toBe(422);

    const deliverRes = await app.inject({
      method: 'POST',
      url: `/shipments/${shipment.id}/events`,
      payload: { kind: 'delivered', location: addis },
    });
    expect(deliverRes.statusCode).toBe(201);

    const trackingRes = await app.inject({
      method: 'GET',
      url: `/shipments/${shipment.id}/tracking`,
    });
    expect(trackingRes.json().map((e: { kind: string }) => e.kind)).toEqual([
      'assigned',
      'delivered',
    ]);

    const operatorsAfter = (await app.inject({ method: 'GET', url: '/operators' })).json();
    const deliveredOperator = operatorsAfter.find(
      (o: { id: string }) => o.id === operator.id,
    );
    expect(deliveredOperator.status).toBe('available');
    expect(deliveredOperator.currentCity).toEqual(addis);
    expect(deliveredOperator.lastDropOffCity).toEqual(addis);

    const invoiceRes = await app.inject({
      method: 'POST',
      url: '/invoices',
      payload: { shipmentId: shipment.id, shipperTin: '0011223345', operatorTin: '0099887766' },
    });
    expect(invoiceRes.statusCode).toBe(201);
    expect(invoiceRes.json()).toMatchObject({
      subtotalEtb: 40000,
      vatEtb: 6000,
      totalEtb: 46000,
    });

    const recoverRes = await app.inject({
      method: 'POST',
      url: `/advances/${advance.id}/transition`,
      payload: { action: 'recover' },
    });
    expect(recoverRes.statusCode).toBe(200);
    expect(recoverRes.json().status).toBe('recovered');
    expect(recoverRes.json().payoutReference).toMatch(/^TB-SIM-/);

    const metricsRes = await app.inject({ method: 'GET', url: '/metrics' });
    expect(metricsRes.statusCode).toBe(200);
    const metrics = metricsRes.json();
    expect(metrics.loads.delivered).toBeGreaterThanOrEqual(1);
    expect(metrics.shipments.delivered).toBeGreaterThanOrEqual(1);
    expect(metrics.avgDeadheadKm).toBeGreaterThanOrEqual(0);
    expect(metrics.zeroDeadheadShare).toBeGreaterThanOrEqual(0);
    expect(metrics.zeroDeadheadShare).toBeLessThanOrEqual(1);
    expect(metrics.advances.byChannel.telebirr).toBeGreaterThanOrEqual(8000);
    expect(metrics.advances.disbursedEtb).toBeGreaterThanOrEqual(8000);
    expect(metrics.vat.invoiceCount).toBeGreaterThanOrEqual(1);
    expect(metrics.vat.totalVatEtb).toBeGreaterThanOrEqual(6000);
    expect(metrics.vat.totalWithVatEtb).toBeGreaterThanOrEqual(46000);
  });

  it('suggests return loads for an operator', async () => {
    const operatorRes = await app.inject({
      method: 'POST',
      url: '/operators',
      payload: {
        name: 'Return Trucks',
        phone: '+251911888999',
        truckPlate: 'AA-77777',
        capacityTons: 25,
        currentCity: jimma,
      },
    });
    expect(operatorRes.statusCode).toBe(201);
    const operator = operatorRes.json();

    const loadRes = await app.inject({
      method: 'POST',
      url: '/loads',
      payload: {
        shipperId: 'shipper-3',
        origin: jimma,
        destination: addis,
        weightTons: 20,
        offeredPriceEtb: 35000,
      },
    });
    const load = loadRes.json();

    const res = await app.inject({ method: 'GET', url: `/operators/${operator.id}/return-loads` });
    expect(res.statusCode).toBe(200);
    const matches = res.json();
    const match = matches.find((m: { loadId: string }) => m.loadId === load.id);
    expect(match).toBeTruthy();
    expect(match.deadheadKm).toBe(0);

    const missing = await app.inject({ method: 'GET', url: '/operators/nope/return-loads' });
    expect(missing.statusCode).toBe(404);
  });

  it('rejects the transition when the payout channel fails', async () => {
    const failing: Record<'telebirr' | 'cbe_birr', PayoutAdapter> = {
      telebirr: failingAdapter('telebirr'),
      cbe_birr: failingAdapter('cbe_birr'),
    };
    const app = await buildServer({ payouts: failing });
    await app.ready();
    try {
      const operatorRes = await app.inject({
        method: 'POST',
        url: '/operators',
        payload: {
          name: 'Fail Fast Logistics',
          phone: '+251911000009',
          truckPlate: 'AA-00001',
          capacityTons: 25,
          currentCity: addis,
        },
      });
      const operator = operatorRes.json();
      const loadRes = await app.inject({
        method: 'POST',
        url: '/loads',
        payload: {
          shipperId: 'shipper-9',
          origin: addis,
          destination: jimma,
          weightTons: 15,
          offeredPriceEtb: 30000,
        },
      });
      const load = loadRes.json();
      const shipmentRes = await app.inject({
        method: 'POST',
        url: '/shipments',
        payload: { loadId: load.id, operatorId: operator.id },
      });
      const shipment = shipmentRes.json();
      const advanceRes = await app.inject({
        method: 'POST',
        url: '/advances',
        payload: {
          operatorId: operator.id,
          shipmentId: shipment.id,
          amountEtb: 2000,
          channel: 'telebirr',
        },
      });
      const advance = advanceRes.json();
      await app.inject({
        method: 'POST',
        url: `/advances/${advance.id}/transition`,
        payload: { action: 'approve' },
      });

      const disburseRes = await app.inject({
        method: 'POST',
        url: `/advances/${advance.id}/transition`,
        payload: { action: 'disburse' },
      });
      expect(disburseRes.statusCode).toBe(409);
      expect(disburseRes.json().error).toMatch(/telebirr payout failed/);

      const stateRes = await app.inject({ method: 'GET', url: '/advances' });
      const stored = stateRes.json().find((a: { id: string }) => a.id === advance.id);
      expect(stored.status).toBe('approved');
      expect(stored.payoutReference).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('rejects oversize advance requests', async () => {
    const operatorRes = await app.inject({
      method: 'POST',
      url: '/operators',
      payload: {
        name: 'Kebede Transport',
        phone: '+251911000001',
        truckPlate: 'AA-67890',
        capacityTons: 30,
        currentCity: addis,
      },
    });
    const operator = operatorRes.json();
    const loadRes = await app.inject({
      method: 'POST',
      url: '/loads',
      payload: {
        shipperId: 'shipper-2',
        origin: addis,
        destination: jimma,
        weightTons: 10,
        offeredPriceEtb: 20000,
      },
    });
    const load = loadRes.json();
    const shipmentRes = await app.inject({
      method: 'POST',
      url: '/shipments',
      payload: { loadId: load.id, operatorId: operator.id },
    });
    const shipment = shipmentRes.json();

    const advanceRes = await app.inject({
      method: 'POST',
      url: '/advances',
      payload: {
        operatorId: operator.id,
        shipmentId: shipment.id,
        amountEtb: 9000,
        channel: 'telebirr',
      },
    });
    expect(advanceRes.statusCode).toBe(422);
    expect(advanceRes.json().errors[0]).toMatch(/20% cap/);
  });
});

describe('domestic ai agent endpoint', async () => {
  const app = await buildServer();

  beforeAll(async () => {
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects empty messages', async () => {
    const res = await app.inject({ method: 'POST', url: '/agent/chat', payload: { message: '' } });
    expect(res.statusCode).toBe(400);
  });

  it('posts a load and finds trucks through conversation', async () => {
    await app.inject({
      method: 'POST',
      url: '/operators',
      payload: {
        name: 'Abebe Trucks',
        phone: '+251911000000',
        truckPlate: 'AA-12345',
        capacityTons: 25,
        currentCity: jimma,
      },
    });

    const postRes = await app.inject({
      method: 'POST',
      url: '/agent/chat',
      payload: {
        message: 'Post 20 tons of coffee from Jimma to Addis Ababa for 40000 birr',
        shipperId: 'shipper-1',
      },
    });
    expect(postRes.statusCode).toBe(200);
    const post = postRes.json();
    expect(post.intent).toBe('post_load');
    const loadId = post.data.id as string;
    expect(loadId).toBeTruthy();

    const matchRes = await app.inject({
      method: 'POST',
      url: '/agent/chat',
      payload: { message: `find trucks for ${loadId}` },
    });
    expect(matchRes.statusCode).toBe(200);
    const match = matchRes.json();
    expect(match.intent).toBe('find_matches');
    expect(match.reply).toContain('Abebe Trucks');

    const assignRes = await app.inject({
      method: 'POST',
      url: '/agent/chat',
      payload: { message: `assign the top match for ${loadId}` },
    });
    expect(assignRes.statusCode).toBe(200);
    expect(assignRes.json().intent).toBe('assign_truck');

    const advanceRes = await app.inject({
      method: 'POST',
      url: '/agent/chat',
      payload: { message: 'request an 8000 birr telebirr advance' },
    });
    expect(advanceRes.statusCode).toBe(200);
    expect(advanceRes.json().intent).toBe('request_advance');
    expect(advanceRes.json().reply).toContain('telebirr');
  });

  it('remembers each conversation session separately', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/agent/chat',
      payload: {
        message: 'Post 20 tons from Jimma to Addis Ababa for 40000 birr',
        shipperId: 'shipper-1',
        sessionId: 'session-a',
      },
    });
    const firstLoadId = first.json().data.id as string;

    await app.inject({
      method: 'POST',
      url: '/agent/chat',
      payload: {
        message: 'Post 10 tons from Adama to Mekelle for 25000 birr',
        shipperId: 'shipper-2',
        sessionId: 'session-b',
      },
    });

    const followUp = await app.inject({
      method: 'POST',
      url: '/agent/chat',
      payload: { message: 'find trucks', sessionId: 'session-a' },
    });
    expect(followUp.statusCode).toBe(200);
    expect(followUp.json().reply).toContain(firstLoadId);
  });

  it('answers unknown messages with help', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/agent/chat',
      payload: { message: 'hello there' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().intent).toBe('unknown');
    expect(res.json().reply).toContain('Domestic AI Agent');
  });
});

function failingAdapter(channel: 'telebirr' | 'cbe_birr'): PayoutAdapter {
  return {
    async disburse(_request: PayoutRequest): Promise<PayoutResult> {
      return { success: false, error: `${channel} outage` };
    },
    async recover(_request: PayoutRequest): Promise<PayoutResult> {
      return { success: false, error: `${channel} outage` };
    },
  };
}
