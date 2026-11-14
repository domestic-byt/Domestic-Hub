import {
  FuelAdvance,
  Load,
  Shipment,
  TrackingEvent,
  TruckOperator,
  VatInvoice,
  Webhook,
} from '@afro-link/shared';

export interface MarketplaceRepo {
  initialize(): Promise<void>;
  close(): Promise<void>;
  saveOperator(operator: TruckOperator): Promise<void>;
  getOperator(id: string): Promise<TruckOperator | undefined>;
  listOperators(): Promise<TruckOperator[]>;
  saveLoad(load: Load): Promise<void>;
  getLoad(id: string): Promise<Load | undefined>;
  listLoads(): Promise<Load[]>;
  latestLoad(): Promise<Load | undefined>;
  saveShipment(shipment: Shipment): Promise<void>;
  getShipment(id: string): Promise<Shipment | undefined>;
  listShipments(): Promise<Shipment[]>;
  latestShipment(): Promise<Shipment | undefined>;
  appendTrackingEvent(event: TrackingEvent): Promise<void>;
  getTrackingEvents(shipmentId: string): Promise<TrackingEvent[]>;
  saveAdvance(advance: FuelAdvance): Promise<void>;
  getAdvance(id: string): Promise<FuelAdvance | undefined>;
  listAdvances(): Promise<FuelAdvance[]>;
  activeAdvancesFor(operatorId: string): Promise<FuelAdvance[]>;
  saveInvoice(invoice: VatInvoice): Promise<void>;
  getInvoice(id: string): Promise<VatInvoice | undefined>;
  listInvoices(): Promise<VatInvoice[]>;
  saveWebhook(webhook: Webhook): Promise<void>;
  listWebhooks(): Promise<Webhook[]>;
  deleteWebhook(id: string): Promise<void>;
}

export class InMemoryRepo implements MarketplaceRepo {
  operators = new Map<string, TruckOperator>();
  loads = new Map<string, Load>();
  shipments = new Map<string, Shipment>();
  advances = new Map<string, FuelAdvance>();
  invoices = new Map<string, VatInvoice>();
  tracking = new Map<string, TrackingEvent[]>();

  async initialize(): Promise<void> {}

  async close(): Promise<void> {}

  async saveOperator(operator: TruckOperator): Promise<void> {
    this.operators.set(operator.id, operator);
  }

  async getOperator(id: string): Promise<TruckOperator | undefined> {
    return this.operators.get(id);
  }

  async listOperators(): Promise<TruckOperator[]> {
    return [...this.operators.values()];
  }

  async saveLoad(load: Load): Promise<void> {
    this.loads.set(load.id, load);
  }

  async getLoad(id: string): Promise<Load | undefined> {
    return this.loads.get(id);
  }

  async listLoads(): Promise<Load[]> {
    return [...this.loads.values()];
  }

  async latestLoad(): Promise<Load | undefined> {
    return [...this.loads.values()].at(-1);
  }

  async saveShipment(shipment: Shipment): Promise<void> {
    this.shipments.set(shipment.id, shipment);
  }

  async getShipment(id: string): Promise<Shipment | undefined> {
    return this.shipments.get(id);
  }

  async listShipments(): Promise<Shipment[]> {
    return [...this.shipments.values()];
  }

  async latestShipment(): Promise<Shipment | undefined> {
    return [...this.shipments.values()].at(-1);
  }

  async appendTrackingEvent(event: TrackingEvent): Promise<void> {
    const events = this.tracking.get(event.shipmentId) ?? [];
    events.push(event);
    this.tracking.set(event.shipmentId, events);
  }

  async getTrackingEvents(shipmentId: string): Promise<TrackingEvent[]> {
    return this.tracking.get(shipmentId) ?? [];
  }

  async saveAdvance(advance: FuelAdvance): Promise<void> {
    this.advances.set(advance.id, advance);
  }

  async getAdvance(id: string): Promise<FuelAdvance | undefined> {
    return this.advances.get(id);
  }

  async listAdvances(): Promise<FuelAdvance[]> {
    return [...this.advances.values()];
  }

  async activeAdvancesFor(operatorId: string): Promise<FuelAdvance[]> {
    return [...this.advances.values()].filter(
      (a) =>
        a.operatorId === operatorId &&
        a.status !== 'recovered' &&
        a.status !== 'rejected' &&
        a.status !== 'defaulted',
    );
  }

  async saveInvoice(invoice: VatInvoice): Promise<void> {
    this.invoices.set(invoice.id, invoice);
  }

  async getInvoice(id: string): Promise<VatInvoice | undefined> {
    return this.invoices.get(id);
  }

  async listInvoices(): Promise<VatInvoice[]> {
    return [...this.invoices.values()];
  }

  webhooks = new Map<string, Webhook>();

  async saveWebhook(webhook: Webhook): Promise<void> {
    this.webhooks.set(webhook.id, webhook);
  }

  async listWebhooks(): Promise<Webhook[]> {
    return [...this.webhooks.values()];
  }

  async deleteWebhook(id: string): Promise<void> {
    this.webhooks.delete(id);
  }
}
