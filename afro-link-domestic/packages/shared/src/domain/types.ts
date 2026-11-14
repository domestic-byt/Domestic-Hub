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

export type ShipmentStatus = 'assigned' | 'in_transit' | 'delivered';

export interface Shipment {
  id: string;
  loadId: string;
  operatorId: string;
  assignedAt: string;
  deliveredAt?: string;
  status: ShipmentStatus;
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
