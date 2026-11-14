import { Pool, QueryResult, QueryResultRow } from 'pg';
import {
  AdvanceChannel,
  AdvanceStatus,
  City,
  FuelAdvance,
  Load,
  LoadStatus,
  ProofOfDelivery,
  Shipment,
  ShipmentStatus,
  TrackingEvent,
  TrackingEventKind,
  TruckOperator,
  VatInvoice,
  Webhook,
  WebhookEvent,
} from '@afro-link/shared';
import type { MarketplaceRepo } from './repo';

type Row = QueryResultRow;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS operators (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  truck_plate TEXT NOT NULL,
  capacity_tons DOUBLE PRECISION NOT NULL,
  current_city JSONB NOT NULL,
  last_drop_off_city JSONB,
  status TEXT NOT NULL,
  license_expiry DATE,
  insurance_expiry DATE
);
CREATE TABLE IF NOT EXISTS loads (
  seq BIGSERIAL,
  id TEXT PRIMARY KEY,
  shipper_id TEXT NOT NULL,
  origin JSONB NOT NULL,
  destination JSONB NOT NULL,
  weight_tons DOUBLE PRECISION NOT NULL,
  available_from TIMESTAMPTZ NOT NULL,
  offered_price_etb DOUBLE PRECISION NOT NULL,
  status TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS shipments (
  seq BIGSERIAL,
  id TEXT PRIMARY KEY,
  load_id TEXT NOT NULL,
  operator_id TEXT NOT NULL,
  assigned_at TIMESTAMPTZ NOT NULL,
  delivered_at TIMESTAMPTZ,
  status TEXT NOT NULL,
  deadhead_km DOUBLE PRECISION,
  pod JSONB
);
CREATE TABLE IF NOT EXISTS tracking_events (
  seq BIGSERIAL,
  shipment_id TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL,
  kind TEXT NOT NULL,
  location JSONB,
  note TEXT
);
CREATE INDEX IF NOT EXISTS tracking_events_shipment_idx ON tracking_events (shipment_id, seq);
CREATE TABLE IF NOT EXISTS fuel_advances (
  id TEXT PRIMARY KEY,
  operator_id TEXT NOT NULL,
  shipment_id TEXT NOT NULL,
  amount_etb DOUBLE PRECISION NOT NULL,
  channel TEXT NOT NULL,
  status TEXT NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL,
  payout_reference TEXT,
  payout_attempts INTEGER,
  last_payout_error TEXT
);
CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  shipment_id TEXT NOT NULL,
  shipper_tin TEXT NOT NULL,
  operator_tin TEXT NOT NULL,
  subtotal_etb DOUBLE PRECISION NOT NULL,
  vat_etb DOUBLE PRECISION NOT NULL,
  total_etb DOUBLE PRECISION NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS webhooks (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  secret TEXT NOT NULL,
  events JSONB NOT NULL,
  owner_id TEXT,
  created_at TIMESTAMPTZ NOT NULL
);
`;

function str(value: unknown): string {
  return value as string;
}

function num(value: unknown): number {
  return Number(value);
}

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : (value as string);
}

function isoOrNull(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : iso(value);
}

function dateOf(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

function cityOf(value: unknown): City | undefined {
  return (value as City | null) ?? undefined;
}

function rowToOperator(row: Row): TruckOperator {
  return {
    id: str(row.id),
    name: str(row.name),
    phone: str(row.phone),
    truckPlate: str(row.truck_plate),
    capacityTons: num(row.capacity_tons),
    currentCity: row.current_city as City,
    lastDropOffCity: cityOf(row.last_drop_off_city),
    status: str(row.status) as TruckOperator['status'],
    licenseExpiry: dateOf(row.license_expiry),
    insuranceExpiry: dateOf(row.insurance_expiry),
  };
}

function rowToLoad(row: Row): Load {
  return {
    id: str(row.id),
    shipperId: str(row.shipper_id),
    origin: row.origin as City,
    destination: row.destination as City,
    weightTons: num(row.weight_tons),
    availableFrom: iso(row.available_from),
    offeredPriceEtb: num(row.offered_price_etb),
    status: str(row.status) as LoadStatus,
  };
}

function rowToShipment(row: Row): Shipment {
  return {
    id: str(row.id),
    loadId: str(row.load_id),
    operatorId: str(row.operator_id),
    assignedAt: iso(row.assigned_at),
    deliveredAt: isoOrNull(row.delivered_at),
    status: str(row.status) as ShipmentStatus,
    deadheadKm: row.deadhead_km === null ? undefined : num(row.deadhead_km),
    pod: (row.pod as ProofOfDelivery | null) ?? undefined,
  };
}

function rowToEvent(row: Row): TrackingEvent {
  return {
    shipmentId: str(row.shipment_id),
    at: iso(row.at),
    kind: str(row.kind) as TrackingEventKind,
    location: cityOf(row.location),
    note: row.note === null ? undefined : str(row.note),
  };
}

function rowToAdvance(row: Row): FuelAdvance {
  return {
    id: str(row.id),
    operatorId: str(row.operator_id),
    shipmentId: str(row.shipment_id),
    amountEtb: num(row.amount_etb),
    channel: str(row.channel) as AdvanceChannel,
    status: str(row.status) as AdvanceStatus,
    requestedAt: iso(row.requested_at),
    payoutReference: row.payout_reference === null ? undefined : str(row.payout_reference),
    payoutAttempts: row.payout_attempts === null ? undefined : num(row.payout_attempts),
    lastPayoutError: row.last_payout_error === null ? undefined : str(row.last_payout_error),
  };
}

function rowToInvoice(row: Row): VatInvoice {
  return {
    id: str(row.id),
    shipmentId: str(row.shipment_id),
    shipperTin: str(row.shipper_tin),
    operatorTin: str(row.operator_tin),
    subtotalEtb: num(row.subtotal_etb),
    vatEtb: num(row.vat_etb),
    totalEtb: num(row.total_etb),
    issuedAt: iso(row.issued_at),
  };
}

function rowToWebhook(row: Row): Webhook {
  return {
    id: str(row.id),
    url: str(row.url),
    secret: str(row.secret),
    events: (row.events as WebhookEvent[]) ?? [],
    ownerId: row.owner_id === null ? undefined : str(row.owner_id),
    createdAt: iso(row.created_at),
  };
}

export class PgRepo implements MarketplaceRepo {
  private constructor(private readonly pool: Pool) {}

  static async connect(connectionString: string): Promise<PgRepo> {
    const repo = new PgRepo(new Pool({ connectionString }));
    await repo.initialize();
    return repo;
  }

  async initialize(): Promise<void> {
    await this.pool.query(SCHEMA);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async saveOperator(operator: TruckOperator): Promise<void> {
    await this.pool.query(
      `INSERT INTO operators (id, name, phone, truck_plate, capacity_tons, current_city, last_drop_off_city, status, license_expiry, insurance_expiry)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name, phone = EXCLUDED.phone, truck_plate = EXCLUDED.truck_plate,
         capacity_tons = EXCLUDED.capacity_tons, current_city = EXCLUDED.current_city,
         last_drop_off_city = EXCLUDED.last_drop_off_city, status = EXCLUDED.status,
         license_expiry = EXCLUDED.license_expiry, insurance_expiry = EXCLUDED.insurance_expiry`,
      [
        operator.id,
        operator.name,
        operator.phone,
        operator.truckPlate,
        operator.capacityTons,
        JSON.stringify(operator.currentCity),
        operator.lastDropOffCity ? JSON.stringify(operator.lastDropOffCity) : null,
        operator.status,
        operator.licenseExpiry ?? null,
        operator.insuranceExpiry ?? null,
      ],
    );
  }

  async getOperator(id: string): Promise<TruckOperator | undefined> {
    const result = await this.pool.query('SELECT * FROM operators WHERE id = $1', [id]);
    return result.rows[0] ? rowToOperator(result.rows[0]) : undefined;
  }

  async listOperators(): Promise<TruckOperator[]> {
    const result = await this.pool.query('SELECT * FROM operators');
    return result.rows.map(rowToOperator);
  }

  async saveLoad(load: Load): Promise<void> {
    await this.pool.query(
      `INSERT INTO loads (id, shipper_id, origin, destination, weight_tons, available_from, offered_price_etb, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET
         shipper_id = EXCLUDED.shipper_id, origin = EXCLUDED.origin, destination = EXCLUDED.destination,
         weight_tons = EXCLUDED.weight_tons, available_from = EXCLUDED.available_from,
         offered_price_etb = EXCLUDED.offered_price_etb, status = EXCLUDED.status`,
      [
        load.id,
        load.shipperId,
        JSON.stringify(load.origin),
        JSON.stringify(load.destination),
        load.weightTons,
        load.availableFrom,
        load.offeredPriceEtb,
        load.status,
      ],
    );
  }

  async getLoad(id: string): Promise<Load | undefined> {
    const result = await this.pool.query('SELECT * FROM loads WHERE id = $1', [id]);
    return result.rows[0] ? rowToLoad(result.rows[0]) : undefined;
  }

  async listLoads(): Promise<Load[]> {
    const result = await this.pool.query('SELECT * FROM loads ORDER BY seq');
    return result.rows.map(rowToLoad);
  }

  async latestLoad(): Promise<Load | undefined> {
    const result = await this.pool.query('SELECT * FROM loads ORDER BY seq DESC LIMIT 1');
    return result.rows[0] ? rowToLoad(result.rows[0]) : undefined;
  }

  async saveShipment(shipment: Shipment): Promise<void> {
    await this.pool.query(
      `INSERT INTO shipments (id, load_id, operator_id, assigned_at, delivered_at, status, deadhead_km, pod)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET
         load_id = EXCLUDED.load_id, operator_id = EXCLUDED.operator_id,
         assigned_at = EXCLUDED.assigned_at, delivered_at = EXCLUDED.delivered_at,
         status = EXCLUDED.status, deadhead_km = EXCLUDED.deadhead_km, pod = EXCLUDED.pod`,
      [
        shipment.id,
        shipment.loadId,
        shipment.operatorId,
        shipment.assignedAt,
        shipment.deliveredAt ?? null,
        shipment.status,
        shipment.deadheadKm ?? null,
        shipment.pod ? JSON.stringify(shipment.pod) : null,
      ],
    );
  }

  async getShipment(id: string): Promise<Shipment | undefined> {
    const result = await this.pool.query('SELECT * FROM shipments WHERE id = $1', [id]);
    return result.rows[0] ? rowToShipment(result.rows[0]) : undefined;
  }

  async listShipments(): Promise<Shipment[]> {
    const result = await this.pool.query('SELECT * FROM shipments ORDER BY seq');
    return result.rows.map(rowToShipment);
  }

  async latestShipment(): Promise<Shipment | undefined> {
    const result = await this.pool.query('SELECT * FROM shipments ORDER BY seq DESC LIMIT 1');
    return result.rows[0] ? rowToShipment(result.rows[0]) : undefined;
  }

  async appendTrackingEvent(event: TrackingEvent): Promise<void> {
    await this.pool.query(
      `INSERT INTO tracking_events (shipment_id, at, kind, location, note)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        event.shipmentId,
        event.at,
        event.kind,
        event.location ? JSON.stringify(event.location) : null,
        event.note ?? null,
      ],
    );
  }

  async getTrackingEvents(shipmentId: string): Promise<TrackingEvent[]> {
    const result: QueryResult<Row> = await this.pool.query(
      'SELECT * FROM tracking_events WHERE shipment_id = $1 ORDER BY seq',
      [shipmentId],
    );
    return result.rows.map(rowToEvent);
  }

  async saveAdvance(advance: FuelAdvance): Promise<void> {
    await this.pool.query(
      `INSERT INTO fuel_advances (id, operator_id, shipment_id, amount_etb, channel, status, requested_at, payout_reference, payout_attempts, last_payout_error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (id) DO UPDATE SET
         operator_id = EXCLUDED.operator_id, shipment_id = EXCLUDED.shipment_id,
         amount_etb = EXCLUDED.amount_etb, channel = EXCLUDED.channel, status = EXCLUDED.status,
         requested_at = EXCLUDED.requested_at, payout_reference = EXCLUDED.payout_reference,
         payout_attempts = EXCLUDED.payout_attempts, last_payout_error = EXCLUDED.last_payout_error`,
      [
        advance.id,
        advance.operatorId,
        advance.shipmentId,
        advance.amountEtb,
        advance.channel,
        advance.status,
        advance.requestedAt,
        advance.payoutReference ?? null,
        advance.payoutAttempts ?? null,
        advance.lastPayoutError ?? null,
      ],
    );
  }

  async getAdvance(id: string): Promise<FuelAdvance | undefined> {
    const result = await this.pool.query('SELECT * FROM fuel_advances WHERE id = $1', [id]);
    return result.rows[0] ? rowToAdvance(result.rows[0]) : undefined;
  }

  async listAdvances(): Promise<FuelAdvance[]> {
    const result = await this.pool.query('SELECT * FROM fuel_advances ORDER BY requested_at');
    return result.rows.map(rowToAdvance);
  }

  async activeAdvancesFor(operatorId: string): Promise<FuelAdvance[]> {
    const result = await this.pool.query(
      `SELECT * FROM fuel_advances
       WHERE operator_id = $1 AND status IN ('requested', 'approved', 'disbursed')`,
      [operatorId],
    );
    return result.rows.map(rowToAdvance);
  }

  async saveInvoice(invoice: VatInvoice): Promise<void> {
    await this.pool.query(
      `INSERT INTO invoices (id, shipment_id, shipper_tin, operator_tin, subtotal_etb, vat_etb, total_etb, issued_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET
         shipment_id = EXCLUDED.shipment_id, shipper_tin = EXCLUDED.shipper_tin,
         operator_tin = EXCLUDED.operator_tin, subtotal_etb = EXCLUDED.subtotal_etb,
         vat_etb = EXCLUDED.vat_etb, total_etb = EXCLUDED.total_etb, issued_at = EXCLUDED.issued_at`,
      [
        invoice.id,
        invoice.shipmentId,
        invoice.shipperTin,
        invoice.operatorTin,
        invoice.subtotalEtb,
        invoice.vatEtb,
        invoice.totalEtb,
        invoice.issuedAt,
      ],
    );
  }

  async getInvoice(id: string): Promise<VatInvoice | undefined> {
    const result = await this.pool.query('SELECT * FROM invoices WHERE id = $1', [id]);
    return result.rows[0] ? rowToInvoice(result.rows[0]) : undefined;
  }

  async listInvoices(): Promise<VatInvoice[]> {
    const result = await this.pool.query('SELECT * FROM invoices ORDER BY issued_at');
    return result.rows.map(rowToInvoice);
  }

  async saveWebhook(webhook: Webhook): Promise<void> {
    await this.pool.query(
      `INSERT INTO webhooks (id, url, secret, events, owner_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET
         url = EXCLUDED.url, secret = EXCLUDED.secret, events = EXCLUDED.events,
         owner_id = EXCLUDED.owner_id, created_at = EXCLUDED.created_at`,
      [
        webhook.id,
        webhook.url,
        webhook.secret,
        JSON.stringify(webhook.events),
        webhook.ownerId ?? null,
        webhook.createdAt,
      ],
    );
  }

  async listWebhooks(): Promise<Webhook[]> {
    const result = await this.pool.query('SELECT * FROM webhooks ORDER BY created_at');
    return result.rows.map(rowToWebhook);
  }

  async deleteWebhook(id: string): Promise<void> {
    await this.pool.query('DELETE FROM webhooks WHERE id = $1', [id]);
  }
}
