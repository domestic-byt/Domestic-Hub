import { describe, expect, it, vi } from 'vitest';
import {
  AdvanceChannel,
  City,
  DomainError,
  FuelAdvance,
  Load,
  Shipment,
  TrackingEvent,
  TruckOperator,
  MarketplaceMetrics,
  OperatorEarnings,
  PriceSuggestion,
  VatInvoice,
  computeVat,
  rankOperatorsForLoad,
  rankReturnLoads,
  suggestPrice,
  validateAdvanceRequest,
} from '@afro-link/shared';
import { DomesticAgent } from '../src/agent';
import { detectIntent } from '../src/intent';
import { extractSlots } from '../src/slots';
import {
  AgentStore,
  LlmAdapter,
  NewAdvanceInput,
  NewInvoiceInput,
  NewLoadInput,
} from '../src/types';

const addis: City = { name: 'Addis Ababa', lat: 9.03, lon: 38.74 };
const jimma: City = { name: 'Jimma', lat: 7.67, lon: 36.83 };

class FakeStore implements AgentStore {
  operators: TruckOperator[] = [];
  loads = new Map<string, Load>();
  shipments = new Map<string, Shipment>();
  advances: FuelAdvance[] = [];
  tracking = new Map<string, TrackingEvent[]>();
  invoices = new Map<string, VatInvoice>();

  async createLoad(input: NewLoadInput): Promise<Load> {
    const load: Load = {
      ...input,
      id: crypto.randomUUID(),
      availableFrom: input.availableFrom ?? new Date().toISOString(),
      status: 'open',
    };
    this.loads.set(load.id, load);
    return load;
  }

  async rankMatches(loadId: string) {
    const load = this.loads.get(loadId);
    if (!load) throw new DomainError('not_found', 'Load not found.');
    return rankOperatorsForLoad(load, this.operators);
  }

  async rankReturnLoads(operatorId: string) {
    const operator = this.operators.find((o) => o.id === operatorId);
    if (!operator) throw new DomainError('not_found', 'Operator not found.');
    return rankReturnLoads(operator, [...this.loads.values()]);
  }

  async assignShipment(loadId: string, operatorId: string): Promise<Shipment> {
    const load = this.loads.get(loadId);
    if (!load) throw new DomainError('not_found', 'Load not found.');
    if (load.status !== 'open') {
      throw new DomainError('conflict', `Load is ${load.status}, not open.`);
    }
    const operator = this.operators.find((o) => o.id === operatorId);
    if (!operator) throw new DomainError('not_found', 'Operator not found.');
    if (operator.capacityTons < load.weightTons) {
      throw new DomainError('conflict', 'Operator capacity is below load weight.');
    }
    const shipment: Shipment = {
      id: crypto.randomUUID(),
      loadId,
      operatorId,
      assignedAt: new Date().toISOString(),
      status: 'assigned',
    };
    this.shipments.set(shipment.id, shipment);
    this.loads.set(loadId, { ...load, status: 'assigned' });
    this.tracking.set(shipment.id, [
      { shipmentId: shipment.id, at: shipment.assignedAt, kind: 'assigned' },
    ]);
    return shipment;
  }

  async requestFuelAdvance(input: NewAdvanceInput): Promise<FuelAdvance> {
    const shipment = this.shipments.get(input.shipmentId);
    if (!shipment) throw new DomainError('not_found', 'Shipment not found.');
    const load = this.loads.get(shipment.loadId);
    if (!load) throw new DomainError('not_found', 'Load not found.');
    const errors = validateAdvanceRequest({
      amountEtb: input.amountEtb,
      load,
      activeAdvances: this.advances.filter(
        (a) =>
          a.operatorId === input.operatorId &&
          !['recovered', 'rejected', 'defaulted'].includes(a.status),
      ),
    });
    if (errors.length > 0) {
      throw new DomainError('validation', errors[0]!, errors);
    }
    const advance: FuelAdvance = {
      ...input,
      id: crypto.randomUUID(),
      status: 'requested',
      requestedAt: new Date().toISOString(),
    };
    this.advances.push(advance);
    return advance;
  }

  async getTracking(shipmentId: string): Promise<TrackingEvent[]> {
    if (!this.shipments.has(shipmentId)) {
      throw new DomainError('not_found', 'Shipment not found.');
    }
    return this.tracking.get(shipmentId) ?? [];
  }

  async createInvoice(input: NewInvoiceInput): Promise<VatInvoice> {
    const shipment = this.shipments.get(input.shipmentId);
    if (!shipment) throw new DomainError('not_found', 'Shipment not found.');
    if (shipment.status !== 'delivered') {
      throw new DomainError('conflict', 'Invoices can only be issued for delivered shipments.');
    }
    const load = this.loads.get(shipment.loadId);
    if (!load) throw new DomainError('not_found', 'Load not found.');
    const vat = computeVat(load.offeredPriceEtb);
    const invoice: VatInvoice = {
      id: crypto.randomUUID(),
      shipmentId: shipment.id,
      shipperTin: input.shipperTin,
      operatorTin: input.operatorTin,
      subtotalEtb: vat.subtotalEtb,
      vatEtb: vat.vatEtb,
      totalEtb: vat.totalEtb,
      issuedAt: new Date().toISOString(),
    };
    this.invoices.set(invoice.id, invoice);
    return invoice;
  }

  async findShipment(shipmentId: string): Promise<Shipment | undefined> {
    return this.shipments.get(shipmentId);
  }

  async findLatestShipment(): Promise<Shipment | undefined> {
    return [...this.shipments.values()].at(-1);
  }

  async findLatestLoad(): Promise<Load | undefined> {
    return [...this.loads.values()].at(-1);
  }

  async capturePod(
    shipmentId: string,
    receiverName: string,
    note?: string,
  ): Promise<Shipment> {
    const shipment = this.shipments.get(shipmentId);
    if (!shipment) throw new DomainError('not_found', 'Shipment not found.');
    if (shipment.status !== 'delivered') {
      throw new DomainError(
        'conflict',
        'Proof of delivery can only be captured on delivered shipments.',
      );
    }
    const updated: Shipment = {
      ...shipment,
      pod: {
        receiverName: receiverName.trim(),
        ...(note ? { note } : {}),
        capturedAt: new Date().toISOString(),
      },
    };
    this.shipments.set(shipmentId, updated);
    return updated;
  }

  async cancelLoad(loadId: string): Promise<Load> {
    const load = this.loads.get(loadId);
    if (!load) throw new DomainError('not_found', 'Load not found.');
    if (load.status !== 'open' && load.status !== 'assigned') {
      throw new DomainError('conflict', `Load is ${load.status}, cannot cancel.`);
    }
    for (const [id, s] of this.shipments) {
      if (s.loadId === loadId && (s.status === 'assigned' || s.status === 'in_transit')) {
        this.shipments.set(id, { ...s, status: 'cancelled' });
      }
    }
    const cancelled = { ...load, status: 'cancelled' as const };
    this.loads.set(loadId, cancelled);
    return cancelled;
  }

  async getEarnings(operatorId: string): Promise<OperatorEarnings> {
    const operator = this.operators.find((o) => o.id === operatorId);
    if (!operator) throw new DomainError('not_found', 'Operator not found.');
    const shipments = [...this.shipments.values()].filter(
      (s) => s.operatorId === operatorId && s.status === 'delivered',
    );
    const grossEtb = shipments.reduce(
      (sum, s) => sum + (this.loads.get(s.loadId)?.offeredPriceEtb ?? 0),
      0,
    );
    const outstandingAdvanceEtb = this.advances
      .filter(
        (a) =>
          a.operatorId === operatorId &&
          (a.status === 'requested' || a.status === 'approved' || a.status === 'disbursed'),
      )
      .reduce((sum, a) => sum + a.amountEtb, 0);
    return {
      operatorId,
      operatorName: operator.name,
      deliveredShipments: shipments.length,
      grossEtb,
      outstandingAdvanceEtb,
      netEtb: grossEtb - outstandingAdvanceEtb,
    };
  }

  async suggestLanePrice(input: {
    origin: City;
    destination: City;
    weightTons: number;
  }): Promise<PriceSuggestion | null> {
    return suggestPrice([...this.loads.values()], input);
  }

  async getMetrics(): Promise<MarketplaceMetrics> {
    const loads = [...this.loads.values()];
    const shipments = [...this.shipments.values()];
    const advances = this.advances;
    const invoices = [...this.invoices.values()];
    return {
      loads: {
        total: loads.length,
        open: loads.filter((l) => l.status === 'open').length,
        assigned: loads.filter((l) => l.status === 'assigned').length,
        delivered: loads.filter((l) => l.status === 'delivered').length,
        cancelled: loads.filter((l) => l.status === 'cancelled').length,
      },
      shipments: {
        total: shipments.length,
        delivered: shipments.filter((s) => s.status === 'delivered').length,
      },
      avgDeadheadKm: 0,
      zeroDeadheadShare: 1,
      advances: {
        total: advances.length,
        disbursedEtb: advances
          .filter((a) => a.status === 'disbursed' || a.status === 'recovered')
          .reduce((sum, a) => sum + a.amountEtb, 0),
        byChannel: { telebirr: 0, cbe_birr: 0 },
      },
      vat: {
        invoiceCount: invoices.length,
        totalVatEtb: invoices.reduce((sum, i) => sum + i.vatEtb, 0),
        totalWithVatEtb: invoices.reduce((sum, i) => sum + i.totalEtb, 0),
      },
    };
  }

  deliver(shipmentId: string): void {
    const shipment = this.shipments.get(shipmentId)!;
    this.shipments.set(shipmentId, { ...shipment, status: 'delivered' });
  }
}

function seededStore(): FakeStore {
  const store = new FakeStore();
  store.operators.push({
    id: 'op-near',
    name: 'Abebe Trucks',
    phone: '+251911000000',
    truckPlate: 'AA-12345',
    capacityTons: 25,
    currentCity: jimma,
    status: 'available',
  });
  return store;
}

describe('detectIntent', () => {
  it('detects English intents', () => {
    expect(detectIntent('Post 20 tons of coffee from Jimma to Addis Ababa')).toBe('post_load');
    expect(detectIntent('find trucks for my load')).toBe('find_matches');
    expect(detectIntent('any return loads for me?')).toBe('find_return_loads');
    expect(detectIntent('looking for a backhaul')).toBe('find_return_loads');
    expect(detectIntent('assign the top match')).toBe('assign_truck');
    expect(detectIntent('request an 8000 birr telebirr advance')).toBe('request_advance');
    expect(detectIntent('where is my shipment?')).toBe('track_shipment');
    expect(detectIntent('issue the VAT invoice')).toBe('create_invoice');
    expect(detectIntent('show me the business report')).toBe('get_metrics');
    expect(detectIntent('ሪፖርት አሳዩኝ')).toBe('get_metrics');
    expect(detectIntent('cancel that load')).toBe('cancel_load');
    expect(detectIntent('ተሰርዝ አስፈልገኛል')).toBe('cancel_load');
    expect(detectIntent('how much have I earned?')).toBe('earnings');
    expect(detectIntent('ገቢዬ ስንት ነው?')).toBe('earnings');
    expect(detectIntent('what price for 20 tons from Jimma to Addis Ababa?')).toBe(
      'price_suggestion',
    );
    expect(detectIntent('ዋጋው ስንት ነው?')).toBe('price_suggestion');
    expect(detectIntent('proof of delivery received by Abebe')).toBe('capture_pod');
    expect(detectIntent('help')).toBe('help');
    expect(detectIntent('xyzzy')).toBe('unknown');
  });

  it('detects Amharic intents', () => {
    expect(detectIntent('ነዳጅ ቅድመ ክፍያ እፈልጋለሁ')).toBe('request_advance');
    expect(detectIntent('ደረሰኝ ስጠኝ')).toBe('create_invoice');
    expect(detectIntent('እርዳታ አስፈልገኝ')).toBe('help');
  });

  it('detects Oromiffa intents', () => {
    expect(detectIntent('kaffaltii dursee gaafadhu')).toBe('request_advance');
    expect(detectIntent('hordoffii qabna?')).toBe('track_shipment');
    expect(detectIntent('fe\'aa haqi')).toBe('cancel_load');
    expect(detectIntent('galii koo')).toBe('earnings');
    expect(detectIntent('gatiin meeqa?')).toBe('price_suggestion');
    expect(detectIntent('konkobaataa argadhu')).toBe('find_matches');
    expect(detectIntent('tirakoobii naaf hiiki')).toBe('get_metrics');
    expect(detectIntent('gargaarsa barbaada')).toBe('help');
  });

  it('detects Somali intents', () => {
    expect(detectIntent('malipo ya mbele i si')).toBe('request_advance');
    expect(detectIntent('raadraac shilinka')).toBe('track_shipment');
    expect(detectIntent('jooji rarka')).toBe('cancel_load');
    expect(detectIntent('dakhligayga')).toBe('earnings');
    expect(detectIntent('qiimaha waa muxuu?')).toBe('price_suggestion');
    expect(detectIntent('babuur la heli karo')).toBe('find_matches');
    expect(detectIntent('mzigo oo cusub')).toBe('post_load');
    expect(detectIntent('caawimo')).toBe('help');
  });

  it('detects Tigrinya intents', () => {
    expect(detectIntent('ቅድሚ ክፍሊት ግባ')).toBe('request_advance');
    expect(detectIntent('ክትታል ኣልዋ')).toBe('track_shipment');
    expect(detectIntent('ስረዝ ኣውዕ')).toBe('cancel_load');
    expect(detectIntent('ወሰኽይ')).toBe('earnings');
    expect(detectIntent('በዕሊ ብልዕልዋ')).toBe('price_suggestion');
    expect(detectIntent('ምድብ ኣባዕ')).toBe('assign_truck');
    expect(detectIntent('ሕበረታ ኣውዕ')).toBe('get_metrics');
    expect(detectIntent('ሓገዝ ኣባዕ')).toBe('help');
  });

  it('detects Swahili intents', () => {
    expect(detectIntent('omba mafuta')).toBe('request_advance');
    expect(detectIntent('fuatilia mzigo')).toBe('track_shipment');
    expect(detectIntent('ghairi mzigo')).toBe('cancel_load');
    expect(detectIntent('mapato yangu')).toBe('earnings');
    expect(detectIntent('bei gani?')).toBe('price_suggestion');
    expect(detectIntent('panga dereva')).toBe('assign_truck');
    expect(detectIntent('weka mzigo mpya')).toBe('post_load');
    expect(detectIntent('vipimo vya biashara')).toBe('get_metrics');
    expect(detectIntent('msaada tafadhali')).toBe('help');
  });
});

describe('extractSlots', () => {
  it('extracts cities, weight, money and channel', () => {
    const slots = extractSlots(
      'Ship 20 tons of coffee from Jimma to Addis Ababa for 40000 birr, pay advance via CBE Birr',
    );
    expect(slots.cities.map((c) => c.name)).toEqual(['Jimma', 'Addis Ababa']);
    expect(slots.weightTons).toBe(20);
    expect(slots.moneyEtb).toBe(40000);
    expect(slots.channel).toBe('cbe_birr');
  });

  it('extracts uuids', () => {
    const id = '123e4567-e89b-12d3-a456-426614174000';
    expect(extractSlots(`track ${id}`).ids).toEqual([id]);
  });
});

describe('DomesticAgent', () => {
  it('posts a load from a natural-language message', async () => {
    const store = seededStore();
    const agent = new DomesticAgent(store);
    const result = await agent.handle(
      'Post 20 tons of coffee from Jimma to Addis Ababa for 40000 birr',
      { shipperId: 'shipper-1' },
    );
    expect(result.intent).toBe('post_load');
    expect(store.loads.size).toBe(1);
    const load = [...store.loads.values()][0]!;
    expect(load.offeredPriceEtb).toBe(40000);
    expect(load.shipperId).toBe('shipper-1');
    expect(result.reply).toContain(load.id);
  });

  it('asks for missing details when posting a load', async () => {
    const agent = new DomesticAgent(seededStore());
    const result = await agent.handle('I want to post a load of coffee');
    expect(result.intent).toBe('post_load');
    expect(result.reply).toMatch(/origin, destination, weight/);
  });

  it('finds and ranks trucks, then assigns the top match', async () => {
    const store = seededStore();
    const agent = new DomesticAgent(store);
    await agent.handle('Post 20 tons from Jimma to Addis Ababa for 40000 birr');

    const matches = await agent.handle('find trucks');
    expect(matches.intent).toBe('find_matches');
    expect(matches.reply).toContain('Abebe Trucks');
    expect(matches.reply).toContain('0 km deadhead');

    const assigned = await agent.handle('assign the top match');
    expect(assigned.intent).toBe('assign_truck');
    expect(store.shipments.size).toBe(1);
    expect(assigned.reply).toMatch(/Shipment \S+ assigned/);
  });

  it('fills missing slots from earlier turns in the same session', async () => {
    const store = seededStore();
    const agent = new DomesticAgent(store);
    await agent.handle('Post 20 tons of coffee from Jimma to Addis Ababa for 40000 birr', {
      sessionKey: 's1',
    });

    const followUp = await agent.handle('post another 15 tons load', { sessionKey: 's1' });
    expect(followUp.intent).toBe('post_load');
    const load = followUp.data as Load;
    expect(load.origin.name).toBe('Jimma');
    expect(load.destination.name).toBe('Addis Ababa');
    expect(load.weightTons).toBe(15);
    expect(load.offeredPriceEtb).toBe(40000);
  });

  it('keeps sessions isolated and remembers the last load per session', async () => {
    const store = seededStore();
    const agent = new DomesticAgent(store);
    const first = await agent.handle('Post 20 tons from Jimma to Addis Ababa for 40000 birr', {
      sessionKey: 's1',
    });
    await agent.handle('Post 10 tons from Adama to Mekelle for 25000 birr', { sessionKey: 's2' });

    const matches = await agent.handle('find trucks', { sessionKey: 's1' });
    expect(matches.reply).toContain((first.data as Load).id);
  });

  it('assigns the remembered load when no id is given', async () => {
    const store = seededStore();
    const agent = new DomesticAgent(store);
    const posted = await agent.handle('Post 20 tons from Jimma to Addis Ababa for 40000 birr', {
      sessionKey: 's1',
    });
    const loadId = (posted.data as Load).id;

    const assigned = await agent.handle('assign the top match', { sessionKey: 's1' });
    expect(assigned.intent).toBe('assign_truck');
    expect((assigned.data as Shipment).loadId).toBe(loadId);
  });

  it('suggests return loads near the truck after a drop-off', async () => {
    const store = seededStore();
    const agent = new DomesticAgent(store);
    await agent.handle('Post 20 tons from Jimma to Addis Ababa for 40000 birr');
    await agent.handle('assign the top match');
    await agent.handle('Post 15 tons of coffee from Jimma to Dire Dawa for 30000 birr');

    const result = await agent.handle('any return loads for me?');
    expect(result.intent).toBe('find_return_loads');
    expect(result.reply).toContain('return load');
    expect(result.reply).toContain('Jimma');
    expect(result.reply).toContain('30000 ETB');
  });

  it('requests a fuel advance through telebirr', async () => {
    const store = seededStore();
    const agent = new DomesticAgent(store);
    await agent.handle('Post 20 tons from Jimma to Addis Ababa for 40000 birr');
    await agent.handle('assign the top match');

    const result = await agent.handle('request an 8000 birr telebirr advance');
    expect(result.intent).toBe('request_advance');
    expect(store.advances).toHaveLength(1);
    expect(store.advances[0]!.channel).toBe<AdvanceChannel>('telebirr');
    expect(result.reply).toContain('8000 ETB');
  });

  it('surfaces domain rule violations as friendly warnings', async () => {
    const store = seededStore();
    const agent = new DomesticAgent(store);
    await agent.handle('Post 20 tons from Jimma to Addis Ababa for 40000 birr');
    await agent.handle('assign the top match');

    const result = await agent.handle('request a 9000 birr telebirr advance');
    expect(result.intent).toBe('request_advance');
    expect(result.reply).toMatch(/⚠️.*20% cap/);
  });

  it('tracks a shipment', async () => {
    const store = seededStore();
    const agent = new DomesticAgent(store);
    await agent.handle('Post 20 tons from Jimma to Addis Ababa for 40000 birr');
    await agent.handle('assign the top match');

    const result = await agent.handle('where is my shipment?');
    expect(result.intent).toBe('track_shipment');
    expect(result.reply).toContain('assigned');
  });

  it('issues a VAT invoice only after delivery', async () => {
    const store = seededStore();
    const agent = new DomesticAgent(store);
    await agent.handle('Post 20 tons from Jimma to Addis Ababa for 40000 birr');
    await agent.handle('assign the top match');

    const early = await agent.handle('issue the VAT invoice');
    expect(early.reply).toMatch(/⚠️.*delivered/);

    store.deliver((await store.findLatestShipment())!.id);
    const result = await agent.handle('issue the VAT invoice', {
      shipperTin: '0011223345',
      operatorTin: '0099887766',
    });
    expect(result.intent).toBe('create_invoice');
    expect(result.reply).toContain('46000 ETB');
  });

  it('cancels a load and reports domain conflicts', async () => {
    const store = seededStore();
    const agent = new DomesticAgent(store);
    await agent.handle('Post 20 tons from Jimma to Addis Ababa for 40000 birr');

    const result = await agent.handle('cancel that load');
    expect(result.intent).toBe('cancel_load');
    expect(result.reply).toContain('cancelled');
    expect((await store.findLatestLoad())!.status).toBe('cancelled');

    const again = await agent.handle('cancel that load');
    expect(again.reply).toMatch(/⚠️.*cancelled/);
  });

  it('captures proof of delivery with a receiver name', async () => {
    const store = seededStore();
    const agent = new DomesticAgent(store);
    await agent.handle('Post 20 tons from Jimma to Addis Ababa for 40000 birr');
    await agent.handle('assign the top match');
    const shipmentId = (await store.findLatestShipment())!.id;

    const early = await agent.handle('confirm delivery received by Abebe Kebede');
    expect(early.intent).toBe('capture_pod');
    expect(early.reply).toMatch(/\u26a0\ufe0f.*delivered/);

    store.deliver(shipmentId);
    const result = await agent.handle('confirm delivery received by Abebe Kebede');
    expect(result.intent).toBe('capture_pod');
    expect(result.reply).toContain('Abebe Kebede');
    expect(store.shipments.get(shipmentId)!.pod?.receiverName).toBe('Abebe Kebede');
  });

  it('asks for the receiver name when capturing proof of delivery', async () => {
    const store = seededStore();
    const agent = new DomesticAgent(store);
    await agent.handle('Post 20 tons from Jimma to Addis Ababa for 40000 birr');
    await agent.handle('assign the top match');
    store.deliver((await store.findLatestShipment())!.id);

    const result = await agent.handle('confirm the delivery please');
    expect(result.intent).toBe('capture_pod');
    expect(result.reply).toContain('receiver');
  });

  it('reports operator earnings after delivery', async () => {
    const store = seededStore();
    const agent = new DomesticAgent(store);
    await agent.handle('Post 20 tons from Jimma to Addis Ababa for 40000 birr');
    await agent.handle('assign the top match');

    const early = await agent.handle('how much have I earned?');
    expect(early.intent).toBe('earnings');
    expect(early.reply).toContain('0 delivered');
    expect(early.reply).toContain('net 0 ETB');

    store.deliver((await store.findLatestShipment())!.id);
    const result = await agent.handle('how much have I earned?');
    expect(result.reply).toContain('1 delivered shipment');
    expect(result.reply).toContain('40000 ETB');
    expect(result.reply).toContain('net 40000 ETB');
  });

  it('suggests lane prices from delivered history', async () => {
    const store = seededStore();
    const agent = new DomesticAgent(store);

    const noData = await agent.handle('what price for 20 tons from Jimma to Addis Ababa?');
    expect(noData.intent).toBe('price_suggestion');
    expect(noData.reply).toMatch(/No delivered loads/);

    for (const price of [40000, 44000, 48000]) {
      const load = await store.createLoad({
        shipperId: 'shipper-1',
        origin: jimma,
        destination: addis,
        weightTons: 20,
        offeredPriceEtb: price,
      });
      store.loads.set(load.id, { ...load, status: 'delivered' });
    }

    const result = await agent.handle('what price for 20 tons from Jimma to Addis Ababa?');
    expect(result.reply).toContain('Suggested price for 20 t');
    expect(result.reply).toContain('ETB/t·km from 3 lane deliveries');
  });

  it('reports marketplace metrics', async () => {
    const store = seededStore();
    const agent = new DomesticAgent(store);
    await agent.handle('Post 20 tons from Jimma to Addis Ababa for 40000 birr');
    await agent.handle('assign the top match');

    const result = await agent.handle('show me the business report');
    expect(result.intent).toBe('get_metrics');
    expect(result.reply).toContain('Loads: 1 total (0 open, 1 assigned, 0 delivered)');
    expect(result.reply).toContain('Shipments: 1 total, 0 delivered');
    expect(result.reply).toContain('avg deadhead');
  });

  it('uses the LLM adapter for the reply when provided', async () => {
    const llm: LlmAdapter = {
      complete: vi.fn().mockResolvedValue('ጭነትዎ ተመዝግቧል!'),
    };
    const agent = new DomesticAgent(seededStore(), llm);
    const result = await agent.handle(
      'Post 20 tons from Jimma to Addis Ababa for 40000 birr',
    );
    expect(result.reply).toBe('ጭነትዎ ተመዝግቧል!');
    expect(llm.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [expect.objectContaining({ role: 'user' })],
      }),
    );
  });
});
