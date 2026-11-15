import {
  AdvanceChannel,
  City,
  FuelAdvance,
  KycDecision,
  KycReview,
  Load,
  MarketplaceMetrics,
  OperatorEarnings,
  OperatorMatch,
  Rating,
  PriceSuggestion,
  ReturnLoadMatch,
  Shipment,
  ShipmentEta,
  TrackingEvent,
  TruckOperator,
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
  listAdvancesFor(operatorId: string): Promise<FuelAdvance[]>;
  listInvoicesFor(shipperId: string): Promise<VatInvoice[]>;
  getTracking(shipmentId: string): Promise<TrackingEvent[]>;
  shipmentEta(shipmentId: string): Promise<ShipmentEta | undefined>;
  createInvoice(input: NewInvoiceInput): Promise<VatInvoice>;
  findShipment(shipmentId: string): Promise<Shipment | undefined>;
  findLatestShipment(): Promise<Shipment | undefined>;
  findLatestLoad(): Promise<Load | undefined>;
  cancelLoad(loadId: string): Promise<Load>;
  counterOffer(loadId: string, operatorId: string, priceEtb: number): Promise<Load>;
  acceptCounterOffer(loadId: string): Promise<Load>;
  capturePod(
    shipmentId: string,
    receiverName: string,
    note?: string,
  ): Promise<Shipment>;
  rateShipment(input: {
    shipmentId: string;
    shipperId: string;
    stars: number;
    comment?: string;
  }): Promise<Rating>;
  getEarnings(operatorId: string): Promise<OperatorEarnings>;
  kycReviewQueue(): Promise<KycReview[]>;
  reviewKyc(input: {
    operatorId: string;
    decision: KycDecision;
    licenseExpiry?: string;
    insuranceExpiry?: string;
  }): Promise<TruckOperator>;
  submitKycDocuments(
    operatorId: string,
    input: {
      licenseNumber?: string;
      licenseExpiry?: string;
      insuranceExpiry?: string;
      licenseDocUrl?: string;
      insuranceDocUrl?: string;
    },
  ): Promise<TruckOperator>;
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
  | 'advance_status'
  | 'track_shipment'
  | 'create_invoice'
  | 'list_invoices'
  | 'get_metrics'
  | 'cancel_load'
  | 'capture_pod'
  | 'rate_shipment'
  | 'review_kyc'
  | 'submit_kyc_docs'
  | 'earnings'
  | 'price_suggestion'
  | 'counter_offer'
  | 'accept_offer'
  | 'export_transcript'
  | 'help'
  | 'unknown';

export interface AgentContext {
  sessionKey?: string;
  shipperId?: string;
  operatorId?: string;
  shipperTin?: string;
  operatorTin?: string;
  lang?: string;
  admin?: boolean;
}

export interface AgentResult {
  intent: AgentIntent;
  reply: string;
  data?: unknown;
}

export interface LlmAdapter {
  complete(input: { system: string; messages: ChatMessage[] }): Promise<string>;
}
