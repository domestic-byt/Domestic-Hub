import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildServer } from '../src/server';
import { signWebhook, WebhookDispatcher } from '../src/webhooks';
import { InMemoryRepo } from '../src/repo';

const addis = { name: 'Addis Ababa', lat: 9.03, lon: 38.74 };
const jimma = { name: 'Jimma', lat: 7.67, lon: 36.83 };

describe('webhook dispatcher', () => {
  it('signs payloads with HMAC-SHA256', () => {
    const body = JSON.stringify({ event: 'shipment.assigned' });
    expect(signWebhook('s3cret', body)).toBe(
      `sha256=${createHmac('sha256', 's3cret').update(body).digest('hex')}`,
    );
  });

  it('delivers only to matching subscriptions and tolerates failures', async () => {
    const repo = new InMemoryRepo();
    await repo.saveWebhook({
      id: 'wh-all',
      url: 'https://hooks.example/all',
      secret: 'secret-all',
      events: [],
      createdAt: new Date().toISOString(),
    });
    await repo.saveWebhook({
      id: 'wh-delivered',
      url: 'https://hooks.example/delivered',
      secret: 'secret-delivered',
      events: ['shipment.delivered'],
      createdAt: new Date().toISOString(),
    });

    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        if (url.includes('all')) throw new Error('boom');
        return new Response('{}', { status: 200 });
      }),
    );
    try {
      const dispatcher = new WebhookDispatcher(repo, 100);
      await dispatcher.dispatch('shipment.assigned', { shipmentId: 's1' });

      expect(calls).toHaveLength(1);
      expect(calls[0]!.url).toBe('https://hooks.example/all');
      const body = calls[0]!.init.body as string;
      const headers = calls[0]!.init.headers as Record<string, string>;
      expect(headers['x-afro-link-event']).toBe('shipment.assigned');
      expect(headers['x-afro-link-signature']).toBe(signWebhook('secret-all', body));
      expect(JSON.parse(body).data.shipmentId).toBe('s1');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('webhook api', async () => {
  const app = await buildServer();

  beforeAll(async () => {
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers, lists (redacted) and deletes webhooks', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/webhooks',
      payload: { url: 'https://hooks.example/shipper', events: ['shipment.delivered'] },
    });
    expect(created.statusCode).toBe(201);
    const webhook = created.json();
    expect(webhook.secret).toBeTruthy();
    expect(webhook.events).toEqual(['shipment.delivered']);

    const invalid = await app.inject({
      method: 'POST',
      url: '/webhooks',
      payload: { url: 'not-a-url' },
    });
    expect(invalid.statusCode).toBe(400);

    const listed = await app.inject({ method: 'GET', url: '/webhooks' });
    expect(listed.statusCode).toBe(200);
    const listedHook = listed.json().find((h: { id: string }) => h.id === webhook.id);
    expect(listedHook.secret).toBeUndefined();

    const deleted = await app.inject({ method: 'DELETE', url: `/webhooks/${webhook.id}` });
    expect(deleted.statusCode).toBe(200);
    const missing = await app.inject({ method: 'DELETE', url: `/webhooks/${webhook.id}` });
    expect(missing.statusCode).toBe(404);
  });

  it('delivers shipment events to registered webhooks', async () => {
    const deliveries: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        deliveries.push({
          url,
          headers: init.headers as Record<string, string>,
          body: init.body as string,
        });
        return new Response('{}', { status: 200 });
      }),
    );
    try {
      const hook = (
        await app.inject({
          method: 'POST',
          url: '/webhooks',
          payload: { url: 'https://hooks.example/flow', events: ['shipment.assigned'] },
        })
      ).json();

      const operator = (
        await app.inject({
          method: 'POST',
          url: '/operators',
          payload: {
            name: 'Hook Trucks',
            phone: '+251911444555',
            truckPlate: 'AA-99999',
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
            shipperId: 'shipper-hook',
            origin: jimma,
            destination: addis,
            weightTons: 10,
            offeredPriceEtb: 20000,
          },
        })
      ).json();

      deliveries.length = 0;
      const shipment = (
        await app.inject({
          method: 'POST',
          url: '/shipments',
          payload: { loadId: load.id, operatorId: operator.id },
        })
      ).json();

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(deliveries).toHaveLength(1);
      expect(deliveries[0]!.url).toBe(hook.url);
      expect(deliveries[0]!.headers['x-afro-link-event']).toBe('shipment.assigned');
      const payload = JSON.parse(deliveries[0]!.body);
      expect(payload.event).toBe('shipment.assigned');
      expect(payload.data.shipment.id).toBe(shipment.id);
      expect(deliveries[0]!.headers['x-afro-link-signature']).toBe(
        signWebhook(hook.secret, deliveries[0]!.body),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('notifies operator.kyc_expiring once per operator and warning', async () => {
    const deliveries: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        deliveries.push({
          url,
          headers: init.headers as Record<string, string>,
          body: init.body as string,
        });
        return new Response('{}', { status: 200 });
      }),
    );
    try {
      const hook = (
        await app.inject({
          method: 'POST',
          url: '/webhooks',
          payload: { url: 'https://hooks.example/kyc', events: ['operator.kyc_expiring'] },
        })
      ).json();

      const soon = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      await app.inject({
        method: 'POST',
        url: '/operators',
        payload: {
          name: 'Expiring Trucks',
          phone: '+251911333222',
          truckPlate: 'AA-33322',
          capacityTons: 21,
          currentCity: addis,
          licenseExpiry: soon,
        },
      });

      deliveries.length = 0;
      await app.inject({ method: 'GET', url: '/admin/kyc' });
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(deliveries).toHaveLength(1);
      expect(deliveries[0]!.url).toBe(hook.url);
      expect(deliveries[0]!.headers['x-afro-link-event']).toBe('operator.kyc_expiring');
      const payload = JSON.parse(deliveries[0]!.body);
      expect(payload.data.operatorName).toBe('Expiring Trucks');
      expect(payload.data.warnings[0]).toContain(soon);

      deliveries.length = 0;
      await app.inject({ method: 'GET', url: '/admin/kyc' });
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(deliveries).toHaveLength(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
