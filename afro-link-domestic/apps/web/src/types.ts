export interface City {
  name: string;
  lat: number;
  lon: number;
}

export interface Operator {
  id: string;
  name: string;
  phone: string;
  truckPlate: string;
  capacityTons: number;
  currentCity: City;
  status: 'available' | 'on_trip';
  licenseExpiry?: string;
  insuranceExpiry?: string;
  kycDecision?: 'pending' | 'approved' | 'rejected';
  licenseNumber?: string;
  licenseDocUrl?: string;
  insuranceDocUrl?: string;
}

export interface AuditEntry {
  id: string;
  at: string;
  actorId: string;
  actorRole: 'shipper' | 'operator' | 'admin' | 'anonymous';
  action: string;
  target: string;
  detail?: string;
}

export interface Webhook {
  id: string;
  url: string;
  events: string[];
  ownerId?: string;
  createdAt: string;
}

export interface WebhookDelivery {
  id: string;
  webhookId: string;
  event: string;
  url: string;
  ok: boolean;
  statusCode?: number;
  error?: string;
  attemptCount: number;
  attemptedAt: string;
  deliveredAt?: string;
}

export interface KycReview {
  operatorId: string;
  operatorName: string;
  truckPlate: string;
  licenseExpiry?: string;
  insuranceExpiry?: string;
  licenseNumber?: string;
  licenseDocUrl?: string;
  insuranceDocUrl?: string;
  decision: 'pending' | 'approved' | 'rejected';
  status: 'unverified' | 'valid' | 'expired' | 'rejected';
  issues: string[];
  expiring: string[];
}

export interface Load {
  id: string;
  shipperId: string;
  origin: City;
  destination: City;
  weightTons: number;
  availableFrom: string;
  offeredPriceEtb: number;
  status: 'open' | 'assigned' | 'delivered' | 'cancelled';
  counterOfferEtb?: number;
  counterOfferBy?: string;
}

export interface OperatorMatch {
  operatorId: string;
  operatorName: string;
  score: number;
  deadheadKm: number;
  reasons: string[];
  ratingAvg?: number;
  ratingCount?: number;
}

export interface Rating {
  id: string;
  shipmentId: string;
  operatorId: string;
  shipperId: string;
  stars: number;
  comment?: string;
  createdAt: string;
}

export interface ReturnLoadMatch {
  loadId: string;
  origin: string;
  destination: string;
  weightTons: number;
  offeredPriceEtb: number;
  deadheadKm: number;
  score: number;
  reasons: string[];
}

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
  status: 'assigned' | 'in_transit' | 'delivered';
  pod?: ProofOfDelivery;
}

export interface TrackingEvent {
  shipmentId: string;
  at: string;
  kind: string;
  location?: City;
  note?: string;
}

export interface ShipmentEta {
  remainingKm: number;
  totalKm: number;
  hoursRemaining: number;
  etaAt: string;
}

export interface FuelAdvance {
  id: string;
  operatorId: string;
  shipmentId: string;
  amountEtb: number;
  channel: 'telebirr' | 'cbe_birr';
  status: 'requested' | 'approved' | 'disbursed' | 'recovered' | 'rejected' | 'defaulted';
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

export interface PriceSuggestion {
  etbPerTonKm: number;
  suggestedEtb: number;
  lowEtb: number;
  highEtb: number;
  distanceKm: number;
  sampleSize: number;
  basis: 'lane' | 'network';
}

export interface FleetEntry {
  operatorId: string;
  name: string;
  truckPlate: string;
  status: string;
  currentCity: string;
  kycStatus: string;
  activeShipment?: {
    shipmentId: string;
    status: string;
    origin: string;
    destination: string;
  };
}

export interface OperatorDashboard {
  operatorId: string;
  operatorName: string;
  currentCity: string;
  activeShipment?: {
    shipmentId: string;
    status: string;
    origin: string;
    destination: string;
  };
  activeAdvance?: FuelAdvance;
  outstandingAdvanceEtb: number;
  deliveredShipments: number;
  netEtb: number;
  returnLoads: ReturnLoadMatch[];
}

export interface OperatorEarnings {
  operatorId: string;
  operatorName: string;
  deliveredShipments: number;
  grossEtb: number;
  outstandingAdvanceEtb: number;
  netEtb: number;
}

export interface FailedPayout {
  advanceId: string;
  operatorId: string;
  channel: string;
  status: string;
  amountEtb: number;
  attempts: number;
  error: string;
}

export interface MarketplaceMetrics {
  loads: { total: number; open: number; assigned: number; delivered: number };
  shipments: { total: number; delivered: number };
  avgDeadheadKm: number;
  zeroDeadheadShare: number;
  advances: {
    total: number;
    disbursedEtb: number;
    byChannel: { telebirr: number; cbe_birr: number };
  };
  vat: { invoiceCount: number; totalVatEtb: number; totalWithVatEtb: number };
  failedPayouts: FailedPayout[];
}

export interface AgentResult {
  intent: string;
  reply: string;
  data?: unknown;
}
