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
}

export interface OperatorMatch {
  operatorId: string;
  operatorName: string;
  score: number;
  deadheadKm: number;
  reasons: string[];
}

export interface Shipment {
  id: string;
  loadId: string;
  operatorId: string;
  assignedAt: string;
  deliveredAt?: string;
  status: 'assigned' | 'in_transit' | 'delivered';
}

export interface TrackingEvent {
  shipmentId: string;
  at: string;
  kind: string;
  location?: City;
  note?: string;
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

export interface AgentResult {
  intent: string;
  reply: string;
  data?: unknown;
}
