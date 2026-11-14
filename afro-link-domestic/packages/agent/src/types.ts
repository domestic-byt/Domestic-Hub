import {
  AdvanceChannel,
  City,
  FuelAdvance,
  Load,
  OperatorMatch,
  Shipment,
  TrackingEvent,
  VatInvoice,
} from '@afro-link/shared';

export interface NewLoadInput {
  shipperId: string;
  origin: City;
  destination: City;
  weightTons: number;
  offeredPriceEtb: number;
  availableFrom?: string;
}

export interface NewAdvanceInput {
  operatorId: string;
  shipmentId: string;
  amountEtb: number;
  channel: AdvanceChannel;
}

export interface NewInvoiceInput {
  shipmentId: string;
  shipperTin: string;
  operatorTin: string;
}

export interface AgentStore {
  createLoad(input: NewLoadInput): Load;
  rankMatches(loadId: string): OperatorMatch[];
  assignShipment(loadId: string, operatorId: string): Shipment;
  requestFuelAdvance(input: NewAdvanceInput): FuelAdvance;
  getTracking(shipmentId: string): TrackingEvent[];
  createInvoice(input: NewInvoiceInput): VatInvoice;
  findShipment(shipmentId: string): Shipment | undefined;
  findLatestShipment(): Shipment | undefined;
  findLatestLoad(): Load | undefined;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export type AgentIntent =
  | 'post_load'
  | 'find_matches'
  | 'assign_truck'
  | 'request_advance'
  | 'track_shipment'
  | 'create_invoice'
  | 'help'
  | 'unknown';

export interface AgentContext {
  shipperId?: string;
  operatorId?: string;
  shipperTin?: string;
  operatorTin?: string;
}

export interface AgentResult {
  intent: AgentIntent;
  reply: string;
  data?: unknown;
}

export interface LlmAdapter {
  complete(input: { system: string; messages: ChatMessage[] }): Promise<string>;
}
