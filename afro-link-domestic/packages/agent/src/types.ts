import {
  AdvanceChannel,
  City,
  FuelAdvance,
  Load,
  MarketplaceMetrics,
  OperatorEarnings,
  OperatorMatch,
  PriceSuggestion,
  ReturnLoadMatch,
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
  createLoad(input: NewLoadInput): Promise<Load>;
  rankMatches(loadId: string): Promise<OperatorMatch[]>;
  rankReturnLoads(operatorId: string): Promise<ReturnLoadMatch[]>;
  assignShipment(loadId: string, operatorId: string): Promise<Shipment>;
  requestFuelAdvance(input: NewAdvanceInput): Promise<FuelAdvance>;
  getTracking(shipmentId: string): Promise<TrackingEvent[]>;
  createInvoice(input: NewInvoiceInput): Promise<VatInvoice>;
  findShipment(shipmentId: string): Promise<Shipment | undefined>;
  findLatestShipment(): Promise<Shipment | undefined>;
  findLatestLoad(): Promise<Load | undefined>;
  cancelLoad(loadId: string): Promise<Load>;
  getEarnings(operatorId: string): Promise<OperatorEarnings>;
  suggestLanePrice(input: {
    origin: City;
    destination: City;
    weightTons: number;
  }): Promise<PriceSuggestion | null>;
  getMetrics(): Promise<MarketplaceMetrics>;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export type AgentIntent =
  | 'post_load'
  | 'find_matches'
  | 'find_return_loads'
  | 'assign_truck'
  | 'request_advance'
  | 'track_shipment'
  | 'create_invoice'
  | 'get_metrics'
  | 'cancel_load'
  | 'earnings'
  | 'price_suggestion'
  | 'help'
  | 'unknown';

export interface AgentContext {
  sessionKey?: string;
  shipperId?: string;
  operatorId?: string;
  shipperTin?: string;
  operatorTin?: string;
  lang?: string;
}

export interface AgentResult {
  intent: AgentIntent;
  reply: string;
  data?: unknown;
}

export interface LlmAdapter {
  complete(input: { system: string; messages: ChatMessage[] }): Promise<string>;
}
