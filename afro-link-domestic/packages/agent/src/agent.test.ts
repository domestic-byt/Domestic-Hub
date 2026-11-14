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
  VatInvoice,
  computeVat,
  rankOperatorsForLoad,
  rankReturnLoads,
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
    expect(detectIntent('help')).toBe('help');
    expect(detectIntent('xyzzy')).toBe('unknown');
  });

  it('detects Amharic intents', () => {
    expect(detectIntent('ነዳጅ ቅድመ ክፍያ እፈልጋለሁ')).toBe('request_advance');
    expect(detectIntent('ደረሰኝ ስጠኝ')).toBe('create_invoice');
    expect(detectIntent('እርዳታ አስፈልገኝ')).toBe('help');
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
