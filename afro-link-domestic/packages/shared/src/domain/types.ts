export interface City {
  name: string;
  lat: number;
  lon: number;
}

export type OperatorStatus = 'available' | 'on_trip';

export interface TruckOperator {
  id: string;
  name: string;
  phone: string;
  truckPlate: string;
  capacityTons: number;
  currentCity: City;
  lastDropOffCity?: City;
  status: OperatorStatus;
  licenseExpiry?: string;
  insuranceExpiry?: string;
}

export type LoadStatus = 'open' | 'assigned' | 'delivered' | 'cancelled';

export interface Load {
  id: string;
  shipperId: string;
  origin: City;
  destination: City;
  weightTons: number;
  availableFrom: string;
  offeredPriceEtb: number;
  status: LoadStatus;
}

export type ShipmentStatus = 'assigned' | 'in_transit' | 'delivered' | 'cancelled';

export interface ProofOfDelivery {
  receiverName: string;
  note?: string;
  capturedAt: string;
}

export interface Shipment {
  id: string;
  loadId: string;
  operatorId: string;
  assignedAt: string;
  deliveredAt?: string;
  status: ShipmentStatus;
  deadheadKm?: number;
  pod?: ProofOfDelivery;
}

export type AdvanceChannel = 'telebirr' | 'cbe_birr';

export type AdvanceStatus =
  | 'requested'
  | 'approved'
  | 'disbursed'
  | 'recovered'
  | 'rejected'
  | 'defaulted';

export interface FuelAdvance {
  id: string;
  operatorId: string;
  shipmentId: string;
  amountEtb: number;
  channel: AdvanceChannel;
  status: AdvanceStatus;
  requestedAt: string;
  payoutReference?: string;
  payoutAttempts?: number;
  lastPayoutError?: string;
}

export interface VatInvoice {
  id: string;
  shipmentId: string;
  shipperTin: string;
  operatorTin: string;
  subtotalEtb: number;
  vatEtb: number;
  totalEtb: number;
  issuedAt: string;
}

export interface OperatorEarnings {
  operatorId: string;
  operatorName: string;
  deliveredShipments: number;
  grossEtb: number;
  outstandingAdvanceEtb: number;
  netEtb: number;
}

export interface MarketplaceMetrics {
  loads: { total: number; open: number; assigned: number; delivered: number; cancelled: number };
  shipments: { total: number; delivered: number };
  avgDeadheadKm: number;
  zeroDeadheadShare: number;
  advances: {
    total: number;
    disbursedEtb: number;
    byChannel: Record<AdvanceChannel, number>;
  };
  vat: { invoiceCount: number; totalVatEtb: number; totalWithVatEtb: number };
}

export type WebhookEvent =
  | 'shipment.assigned'
  | 'shipment.picked_up'
  | 'shipment.delivered'
  | 'load.cancelled';

export interface Webhook {
  id: string;
  url: string;
  secret: string;
  events: WebhookEvent[];
  ownerId?: string;
  createdAt: string;
}

export type TrackingEventKind =
  | 'assigned'
  | 'picked_up'
  | 'in_transit'
  | 'at_checkpoint'
  | 'delivered';

export interface TrackingEvent {
  shipmentId: string;
  at: string;
  kind: TrackingEventKind;
  location?: City;
  note?: string;
}
