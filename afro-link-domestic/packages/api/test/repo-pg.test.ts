import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { PgRepo } from '../src/repo-pg';

const addis = { name: 'Addis Ababa', lat: 9.03, lon: 38.74 };
const jimma = { name: 'Jimma', lat: 7.67, lon: 36.83 };

describe.skipIf(!process.env.DATABASE_URL)('pg repo', () => {
  let repo: PgRepo;

  beforeAll(async () => {
    repo = await PgRepo.connect(process.env.DATABASE_URL!);
    const cleaner = new Pool({ connectionString: process.env.DATABASE_URL });
    await cleaner.query(
      'TRUNCATE operators, loads, shipments, tracking_events, fuel_advances, invoices, webhooks',
    );
    await cleaner.end();
  });

  afterAll(async () => {
    await repo.close();
  });

  it('stores and retrieves operators with cities', async () => {
    const operator = {
      id: `op-${crypto.randomUUID()}`,
      name: 'Pg Trucks',
      phone: '+251911111111',
      truckPlate: 'PG-0001',
      capacityTons: 30,
      currentCity: addis,
      lastDropOffCity: jimma,
      status: 'available' as const,
    };
    await repo.saveOperator(operator);
    const fetched = await repo.getOperator(operator.id);
    expect(fetched).toEqual(operator);

    const updated = {
      ...operator,
      status: 'on_trip' as const,
      lastDropOffCity: undefined,
      licenseExpiry: '2027-03-01',
      insuranceExpiry: '2028-07-15',
    };
    await repo.saveOperator(updated);
    expect(await repo.getOperator(operator.id)).toEqual(updated);
    expect((await repo.listOperators()).some((o) => o.id === operator.id)).toBe(true);

    await repo.saveOperator({ ...operator, status: 'available' as const });
    const cleared = await repo.getOperator(operator.id);
    expect(cleared?.licenseExpiry).toBeUndefined();
    expect(cleared?.insuranceExpiry).toBeUndefined();
  });

  it('stores loads and returns them in insertion order with latestLoad', async () => {
    const first = {
      id: `load-${crypto.randomUUID()}`,
      shipperId: 'shipper-pg-1',
      origin: jimma,
      destination: addis,
      weightTons: 20,
      availableFrom: '2025-01-10T08:00:00.000Z',
      offeredPriceEtb: 40000,
      status: 'open' as const,
    };
    const second = { ...first, id: `load-${crypto.randomUUID()}`, weightTons: 15 };
    await repo.saveLoad(first);
    await repo.saveLoad(second);

    expect(await repo.getLoad(first.id)).toEqual(first);
    const listed = (await repo.listLoads()).filter((l) => l.id === first.id || l.id === second.id);
    expect(listed.map((l) => l.id)).toEqual([first.id, second.id]);
    expect((await repo.latestLoad())?.id).toBe(second.id);

    await repo.saveLoad({ ...first, status: 'assigned' });
    expect((await repo.getLoad(first.id))?.status).toBe('assigned');
  });

  it('stores shipments with optional deliveredAt and latestShipment', async () => {
    const shipment = {
      id: `shp-${crypto.randomUUID()}`,
      loadId: `load-${crypto.randomUUID()}`,
      operatorId: `op-${crypto.randomUUID()}`,
      assignedAt: '2025-01-11T09:00:00.000Z',
      status: 'assigned' as const,
    };
    await repo.saveShipment(shipment);
    expect(await repo.getShipment(shipment.id)).toEqual(shipment);

    const pod = {
      receiverName: 'Abebe Kebede',
      note: 'Offloaded at the warehouse gate',
      capturedAt: '2025-01-12T18:05:00.000Z',
    };
    await repo.saveShipment({
      ...shipment,
      status: 'delivered',
      deliveredAt: '2025-01-12T18:00:00.000Z',
      pod,
    });
    expect(await repo.getShipment(shipment.id)).toEqual({
      ...shipment,
      status: 'delivered',
      deliveredAt: '2025-01-12T18:00:00.000Z',
      pod,
    });

    await repo.saveShipment({ ...shipment, status: 'delivered', deliveredAt: '2025-01-12T18:00:00.000Z' });
    expect(await repo.getShipment(shipment.id)).toEqual({
      ...shipment,
      status: 'delivered',
      deliveredAt: '2025-01-12T18:00:00.000Z',
    });
    expect((await repo.latestShipment())?.id).toBe(shipment.id);
  });

  it('appends tracking events in order per shipment', async () => {
    const shipmentId = `shp-${crypto.randomUUID()}`;
    await repo.appendTrackingEvent({ shipmentId, at: '2025-01-11T09:00:00.000Z', kind: 'assigned' });
    await repo.appendTrackingEvent({
      shipmentId,
      at: '2025-01-11T12:00:00.000Z',
      kind: 'in_transit',
      location: jimma,
      note: 'crossed Gilgel Gibe',
    });
    await repo.appendTrackingEvent({
      shipmentId,
      at: '2025-01-12T18:00:00.000Z',
      kind: 'delivered',
      location: addis,
    });

    const events = await repo.getTrackingEvents(shipmentId);
    expect(events.map((e) => e.kind)).toEqual(['assigned', 'in_transit', 'delivered']);
    const [, transit, delivered] = events;
    expect(transit?.location).toEqual(jimma);
    expect(transit?.note).toBe('crossed Gilgel Gibe');
    expect(delivered?.note).toBeUndefined();
  });

  it('stores advances and filters active ones per operator', async () => {
    const operatorId = `op-${crypto.randomUUID()}`;
    const base = {
      operatorId,
      shipmentId: `shp-${crypto.randomUUID()}`,
      amountEtb: 5000,
      channel: 'telebirr' as const,
      requestedAt: '2025-01-11T09:30:00.000Z',
    };
    const active = { id: `adv-${crypto.randomUUID()}`, ...base, status: 'disbursed' as const };
    const done = { id: `adv-${crypto.randomUUID()}`, ...base, status: 'recovered' as const };
    const other = {
      id: `adv-${crypto.randomUUID()}`,
      ...base,
      operatorId: `op-${crypto.randomUUID()}`,
      status: 'approved' as const,
    };

    await repo.saveAdvance(active);
    await repo.saveAdvance(done);
    await repo.saveAdvance(other);

    expect(await repo.getAdvance(active.id)).toEqual(active);
    expect((await repo.activeAdvancesFor(operatorId)).map((a) => a.id)).toEqual([active.id]);

    await repo.saveAdvance({ ...active, status: 'recovered', payoutReference: 'TB-SIM-TEST' });
    expect(await repo.getAdvance(active.id)).toEqual({
      ...active,
      status: 'recovered',
      payoutReference: 'TB-SIM-TEST',
    });
    expect(await repo.activeAdvancesFor(operatorId)).toEqual([]);
  });

  it('stores VAT invoices', async () => {
    const invoice = {
      id: `inv-${crypto.randomUUID()}`,
      shipmentId: `shp-${crypto.randomUUID()}`,
      shipperTin: '0011223345',
      operatorTin: '0099887766',
      subtotalEtb: 40000,
      vatEtb: 6000,
      totalEtb: 46000,
      issuedAt: '2025-01-13T10:00:00.000Z',
    };
    await repo.saveInvoice(invoice);
    expect(await repo.getInvoice(invoice.id)).toEqual(invoice);
    expect((await repo.listInvoices()).some((i) => i.id === invoice.id)).toBe(true);
  });

  it('stores webhooks with event filters', async () => {
    const webhook = {
      id: `wh-${crypto.randomUUID()}`,
      url: 'https://hooks.example/pg',
      secret: 'pg-secret',
      events: ['shipment.delivered' as const],
      ownerId: 'shipper-1',
      createdAt: '2025-01-14T10:00:00.000Z',
    };
    await repo.saveWebhook(webhook);
    expect((await repo.listWebhooks()).find((h) => h.id === webhook.id)).toEqual(webhook);
    await repo.deleteWebhook(webhook.id);
    expect((await repo.listWebhooks()).some((h) => h.id === webhook.id)).toBe(false);
  });
});
