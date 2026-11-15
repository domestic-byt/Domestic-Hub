import {
  FuelAdvance,
  Load,
  Shipment,
  TrackingEvent,
  TruckOperator,
  Rating,
  VatInvoice,
  Webhook,
  WebhookDelivery,
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
  saveDelivery(delivery: WebhookDelivery): Promise<void>;
  getDelivery(id: string): Promise<WebhookDelivery | undefined>;
  listDeliveries(webhookId?: string, limit?: number): Promise<WebhookDelivery[]>;
  saveRating(rating: Rating): Promise<void>;
  ratingByShipment(shipmentId: string): Promise<Rating | undefined>;
  ratingsForOperator(operatorId: string): Promise<Rating[]>;
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
  ratings = new Map<string, Rating>();
  deliveries: WebhookDelivery[] = [];

  async saveWebhook(webhook: Webhook): Promise<void> {
    this.webhooks.set(webhook.id, webhook);
  }

  async listWebhooks(): Promise<Webhook[]> {
    return [...this.webhooks.values()];
  }

  async saveRating(rating: Rating): Promise<void> {
    this.ratings.set(rating.shipmentId, rating);
  }

  async ratingByShipment(shipmentId: string): Promise<Rating | undefined> {
    return this.ratings.get(shipmentId);
  }

  async ratingsForOperator(operatorId: string): Promise<Rating[]> {
    return [...this.ratings.values()].filter((r) => r.operatorId === operatorId);
  }

  async deleteWebhook(id: string): Promise<void> {
    this.webhooks.delete(id);
  }

  async saveDelivery(delivery: WebhookDelivery): Promise<void> {
    const index = this.deliveries.findIndex((d) => d.id === delivery.id);
    if (index >= 0) {
      this.deliveries[index] = delivery;
    } else {
      this.deliveries.push(delivery);
    }
  }

  async getDelivery(id: string): Promise<WebhookDelivery | undefined> {
    return this.deliveries.find((d) => d.id === id);
  }

  async listDeliveries(webhookId?: string, limit = 50): Promise<WebhookDelivery[]> {
    return this.deliveries
      .filter((d) => webhookId === undefined || d.webhookId === webhookId)
      .slice(-limit)
      .reverse();
  }
}
