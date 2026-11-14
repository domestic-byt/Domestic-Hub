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

    const podRes = await app.inject({
      method: 'POST',
      url: `/shipments/${shipment.id}/pod`,
      payload: { receiverName: 'Abebe Kebede', note: 'Offloaded at the warehouse gate' },
    });
    expect(podRes.statusCode).toBe(201);
    expect(podRes.json().pod).toMatchObject({ receiverName: 'Abebe Kebede' });

    const missingPod = await app.inject({
      method: 'POST',
      url: `/shipments/${shipment.id}/pod`,
      payload: { note: 'no receiver' },
    });
    expect(missingPod.statusCode).toBe(422);

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

  it('blocks assigning operators with expired KYC documents', async () => {
    const app = await buildServer();
    const addis = { name: 'Addis Ababa', lat: 9.03, lon: 38.74 };
    const operatorRes = await app.inject({
      method: 'POST',
      url: '/operators',
      payload: {
        name: 'Expired KYC Trucks',
        phone: '+251911007766',
        truckPlate: 'AA-88224',
        capacityTons: 30,
        currentCity: addis,
        licenseExpiry: '2020-01-01',
        insuranceExpiry: '2030-01-01',
      },
    });
    expect(operatorRes.statusCode).toBe(201);
    const operator = operatorRes.json();
    expect(operator.licenseExpiry).toBe('2020-01-01');

    const badDate = await app.inject({
      method: 'POST',
      url: '/operators',
      payload: {
        name: 'Bad Date Trucks',
        phone: '+251911005544',
        truckPlate: 'AA-66331',
        capacityTons: 30,
        currentCity: addis,
        licenseExpiry: 'next Tuesday',
      },
    });
    expect(badDate.statusCode).toBe(422);

    const loadRes = await app.inject({
      method: 'POST',
      url: '/loads',
      payload: {
        shipperId: 'shipper-kyc',
        origin: addis,
        destination: { name: 'Adama', lat: 8.54, lon: 39.27 },
        weightTons: 10,
        offeredPriceEtb: 15000,
      },
    });
    const load = loadRes.json();

    const matches = await app.inject({ method: 'GET', url: `/loads/${load.id}/matches` });
    const matchIds = matches.json().map((m: { operatorId: string }) => m.operatorId);
    expect(matchIds).not.toContain(operator.id);

    const assignRes = await app.inject({
      method: 'POST',
      url: '/shipments',
      payload: { loadId: load.id, operatorId: operator.id },
    });
    expect(assignRes.statusCode).toBe(409);
    expect(assignRes.json().error).toMatch(/KYC failed.*license/i);

    await app.close();
  });

  it('blocks proof of delivery on shipments that are not delivered', async () => {
    const app = await buildServer();
    const addis = { name: 'Addis Ababa', lat: 9.03, lon: 38.74 };
    const operatorRes = await app.inject({
      method: 'POST',
      url: '/operators',
      payload: {
        name: 'POD Trucks',
        phone: '+251911009988',
        truckPlate: 'AA-99117',
        capacityTons: 30,
        currentCity: addis,
      },
    });
    const operator = operatorRes.json();
    const loadRes = await app.inject({
      method: 'POST',
      url: '/loads',
      payload: {
        shipperId: 'shipper-pod',
        origin: addis,
        destination: { name: 'Adama', lat: 8.54, lon: 39.27 },
        weightTons: 10,
        offeredPriceEtb: 15000,
      },
    });
    const load = loadRes.json();
    const shipmentRes = await app.inject({
      method: 'POST',
      url: '/shipments',
      payload: { loadId: load.id, operatorId: operator.id },
    });
    const shipment = shipmentRes.json();

    const podRes = await app.inject({
      method: 'POST',
      url: `/shipments/${shipment.id}/pod`,
      payload: { receiverName: 'Too Early' },
    });
    expect(podRes.statusCode).toBe(409);
    expect(podRes.json().error).toMatch(/delivered/i);

    await app.close();
  });

  it('cancels an assigned load and frees the operator', async () => {
    const operator = (
      await app.inject({
        method: 'POST',
        url: '/operators',
        payload: {
          name: 'Cancel Trucks',
          phone: '+251911666777',
          truckPlate: 'AA-55555',
          capacityTons: 25,
          currentCity: addis,
        },
      })
    ).json();
    const load = (
      await app.inject({
        method: 'POST',
        url: '/loads',
        payload: {
          shipperId: 'shipper-cancel',
          origin: addis,
          destination: jimma,
          weightTons: 10,
          offeredPriceEtb: 15000,
        },
      })
    ).json();

    await app.inject({
      method: 'POST',
      url: '/shipments',
      payload: { loadId: load.id, operatorId: operator.id },
    });

    const cancelRes = await app.inject({ method: 'POST', url: `/loads/${load.id}/cancel` });
    expect(cancelRes.statusCode).toBe(200);
    expect(cancelRes.json().status).toBe('cancelled');

    const operatorsAfter = (await app.inject({ method: 'GET', url: '/operators' })).json();
    expect(operatorsAfter.find((o: { id: string }) => o.id === operator.id).status).toBe(
      'available',
    );

    const again = await app.inject({ method: 'POST', url: `/loads/${load.id}/cancel` });
    expect(again.statusCode).toBe(409);
  });

  it('blocks cancelling delivered loads and loads with active advances', async () => {
    const operator = (
      await app.inject({
        method: 'POST',
        url: '/operators',
        payload: {
          name: 'Block Trucks',
          phone: '+251911777888',
          truckPlate: 'AA-66666',
          capacityTons: 25,
          currentCity: jimma,
        },
      })
    ).json();
    const load = (
      await app.inject({
        method: 'POST',
        url: '/loads',
        payload: {
          shipperId: 'shipper-block',
          origin: jimma,
          destination: addis,
          weightTons: 10,
          offeredPriceEtb: 20000,
        },
      })
    ).json();
    const shipment = (
      await app.inject({
        method: 'POST',
        url: '/shipments',
        payload: { loadId: load.id, operatorId: operator.id },
      })
    ).json();

    const advance = (
      await app.inject({
        method: 'POST',
        url: '/advances',
        payload: {
          operatorId: operator.id,
          shipmentId: shipment.id,
          amountEtb: 2000,
          channel: 'cbe_birr',
        },
      })
    ).json();

    const withAdvance = await app.inject({ method: 'POST', url: `/loads/${load.id}/cancel` });
    expect(withAdvance.statusCode).toBe(409);
    expect(withAdvance.json().error).toMatch(/advance/i);

    await app.inject({
      method: 'POST',
      url: `/advances/${advance.id}/transition`,
      payload: { action: 'reject' },
    });
    const deliverRes = await app.inject({
      method: 'POST',
      url: `/shipments/${shipment.id}/events`,
      payload: { kind: 'delivered', location: addis },
    });
    expect(deliverRes.statusCode).toBe(201);

    const delivered = await app.inject({ method: 'POST', url: `/loads/${load.id}/cancel` });
    expect(delivered.statusCode).toBe(409);
    expect(delivered.json().error).toMatch(/delivered/i);
  });

  it('suggests lane prices from delivered history', async () => {
    for (const [i, price] of [40000, 44000, 48000].entries()) {
      const operator = (
        await app.inject({
          method: 'POST',
          url: '/operators',
          payload: {
            name: `Pricing Trucks ${i}`,
            phone: `+25191200000${i}`,
            truckPlate: `AP-000${i}`,
            capacityTons: 25,
            currentCity: jimma,
          },
        })
      ).json();
      const load = (
        await app.inject({
          method: 'POST',
          url: '/loads',
          payload: {
            shipperId: 'shipper-pricing',
            origin: jimma,
            destination: addis,
            weightTons: 20,
            offeredPriceEtb: price,
          },
        })
      ).json();
      const shipment = (
        await app.inject({
          method: 'POST',
          url: '/shipments',
          payload: { loadId: load.id, operatorId: operator.id },
        })
      ).json();
      await app.inject({
        method: 'POST',
        url: `/shipments/${shipment.id}/events`,
        payload: { kind: 'delivered', location: addis },
      });
    }

    const suggestion = await app.inject({
      method: 'GET',
      url: '/markets/prices?origin=Jimma&destination=Addis%20Ababa&weightTons=20',
    });
    expect(suggestion.statusCode).toBe(200);
    expect(suggestion.json().basis).toBe('lane');
    expect(suggestion.json().sampleSize).toBeGreaterThanOrEqual(3);
    expect(suggestion.json().suggestedEtb).toBeGreaterThan(0);

    const badParams = await app.inject({ method: 'GET', url: '/markets/prices?origin=Jimma' });
    expect(badParams.statusCode).toBe(400);

    const unknownCity = await app.inject({
      method: 'GET',
      url: '/markets/prices?origin=Narnia&destination=Addis%20Ababa&weightTons=20',
    });
    expect(unknownCity.statusCode).toBe(404);
  });

  it('reports operator earnings', async () => {
    const operator = (
      await app.inject({
        method: 'POST',
        url: '/operators',
        payload: {
          name: 'Earnings Trucks',
          phone: '+251911999000',
          truckPlate: 'AA-33333',
          capacityTons: 25,
          currentCity: addis,
        },
      })
    ).json();
    const load = (
      await app.inject({
        method: 'POST',
        url: '/loads',
        payload: {
          shipperId: 'shipper-earnings',
          origin: addis,
          destination: jimma,
          weightTons: 10,
          offeredPriceEtb: 30000,
        },
      })
    ).json();
    const shipment = (
      await app.inject({
        method: 'POST',
        url: '/shipments',
        payload: { loadId: load.id, operatorId: operator.id },
      })
    ).json();
    await app.inject({
      method: 'POST',
      url: '/advances',
      payload: {
        operatorId: operator.id,
        shipmentId: shipment.id,
        amountEtb: 3000,
        channel: 'telebirr',
      },
    });

    const before = await app.inject({ method: 'GET', url: `/operators/${operator.id}/earnings` });
    expect(before.statusCode).toBe(200);
    expect(before.json()).toMatchObject({
      operatorId: operator.id,
      deliveredShipments: 0,
      grossEtb: 0,
      outstandingAdvanceEtb: 3000,
      netEtb: -3000,
    });

    await app.inject({
      method: 'POST',
      url: `/shipments/${shipment.id}/events`,
      payload: { kind: 'delivered', location: jimma },
    });

    const after = await app.inject({ method: 'GET', url: `/operators/${operator.id}/earnings` });
    expect(after.json()).toMatchObject({
      deliveredShipments: 1,
      grossEtb: 30000,
      outstandingAdvanceEtb: 3000,
      netEtb: 27000,
    });

    const missing = await app.inject({ method: 'GET', url: '/operators/nope/earnings' });
    expect(missing.statusCode).toBe(404);
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
      expect(stored.payoutAttempts).toBe(1);
      expect(stored.lastPayoutError).toMatch(/telebirr payout failed/);
    } finally {
      await app.close();
    }
  });

  it('retries a failed payout through the admin endpoint', async () => {
    let disburseCalls = 0;
    const flaky: Record<'telebirr' | 'cbe_birr', PayoutAdapter> = {
      telebirr: {
        async disburse() {
          disburseCalls += 1;
          if (disburseCalls === 1) {
            return { success: false, error: 'telebirr outage' };
          }
          return { success: true, reference: 'TB-RETRY-OK1' };
        },
        async recover() {
          return { success: true, reference: 'TB-RETRY-OK2' };
        },
      },
      cbe_birr: failingAdapter('cbe_birr'),
    };
    const app = await buildServer({ payouts: flaky });
    await app.ready();
    try {
      const operatorRes = await app.inject({
        method: 'POST',
        url: '/operators',
        payload: {
          name: 'Retry Logistics',
          phone: '+251911000010',
          truckPlate: 'AA-00002',
          capacityTons: 25,
          currentCity: addis,
        },
      });
      const operator = operatorRes.json();
      const loadRes = await app.inject({
        method: 'POST',
        url: '/loads',
        payload: {
          shipperId: 'shipper-10',
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

      const earlyRetry = await app.inject({
        method: 'POST',
        url: `/advances/${advance.id}/retry-payout`,
      });
      expect(earlyRetry.statusCode).toBe(409);
      expect(earlyRetry.json().error).toMatch(/status 'requested'/);

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

      const retryRes = await app.inject({
        method: 'POST',
        url: `/advances/${advance.id}/retry-payout`,
      });
      expect(retryRes.statusCode).toBe(200);
      expect(retryRes.json().status).toBe('disbursed');
      expect(retryRes.json().payoutReference).toBe('TB-RETRY-OK1');
      expect(retryRes.json().payoutAttempts).toBe(2);
      expect(retryRes.json().lastPayoutError).toBeUndefined();
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
        capacityTons: 21,
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
