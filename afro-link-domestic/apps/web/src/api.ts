import { enqueue, requestBackgroundSync } from './outbox';
import type {
  AgentResult,
  City,
  FuelAdvance,
  Load,
  MarketplaceMetrics,
  Operator,
  OperatorEarnings,
  OperatorMatch,
  PriceSuggestion,
  ReturnLoadMatch,
  Shipment,
  TrackingEvent,
  VatInvoice,
} from './types';

const API_BASE: string = import.meta.env.VITE_API_BASE ?? '/api';
const TOKEN_KEY = 'afrolink.token';

let authToken: string | null =
  typeof localStorage !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null;

export function setAuthToken(token: string | null): void {
  authToken = token && token.trim() !== '' ? token.trim() : null;
  if (typeof localStorage !== 'undefined') {
    if (authToken) {
      localStorage.setItem(TOKEN_KEY, authToken);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  }
}

export function getAuthToken(): string | null {
  return authToken;
}

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

const SESSION_KEY = 'afrolink.session';

export function getSessionId(): string {
  if (typeof localStorage === 'undefined') return 'server';
  let id = localStorage.getItem(SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, method: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (authToken) headers.authorization = `Bearer ${authToken}`;
  let res: Response;
  try {
    res = await fetch(apiUrl(path), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    if (method === 'POST') {
      enqueue(path, body);
      requestBackgroundSync();
      throw new ApiError(0, 'You are offline — the request was queued and will sync automatically.');
    }
    throw new ApiError(0, 'You are offline.');
  }
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const p = payload as { error?: string; errors?: string[] } | null;
    const message =
      p?.error ?? p?.errors?.join(' ') ?? `Request failed (${res.status})`;
    throw new ApiError(res.status, message);
  }
  return payload as T;
}

export const api = {
  listOperators: () => request<Operator[]>('/operators', 'GET'),
  createOperator: (input: {
    name: string;
    phone: string;
    truckPlate: string;
    capacityTons: number;
    currentCity: City;
    licenseExpiry?: string;
    insuranceExpiry?: string;
  }) => request<Operator>('/operators', 'POST', input),

  listLoads: () => request<Load[]>('/loads', 'GET'),
  createLoad: (input: {
    shipperId: string;
    origin: City;
    destination: City;
    weightTons: number;
    offeredPriceEtb: number;
  }) => request<Load>('/loads', 'POST', input),
  getMatches: (loadId: string) => request<OperatorMatch[]>(`/loads/${loadId}/matches`, 'GET'),
  cancelLoad: (loadId: string) => request<Load>(`/loads/${loadId}/cancel`, 'POST'),

  getSuggestedPrice: (origin: string, destination: string, weightTons: number) =>
    request<PriceSuggestion>(
      `/markets/prices?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&weightTons=${weightTons}`,
      'GET',
    ),

  getReturnLoads: (operatorId: string) =>
    request<ReturnLoadMatch[]>(`/operators/${operatorId}/return-loads`, 'GET'),

  getEarnings: (operatorId: string) =>
    request<OperatorEarnings>(`/operators/${operatorId}/earnings`, 'GET'),

  createShipment: (loadId: string, operatorId: string) =>
    request<Shipment>('/shipments', 'POST', { loadId, operatorId }),
  addTrackingEvent: (shipmentId: string, kind: string, location?: City) =>
    request<TrackingEvent>(`/shipments/${shipmentId}/events`, 'POST', { kind, location }),
  getTracking: (shipmentId: string) =>
    request<TrackingEvent[]>(`/shipments/${shipmentId}/tracking`, 'GET'),
  capturePod: (shipmentId: string, receiverName: string, note?: string) =>
    request<Shipment>(`/shipments/${shipmentId}/pod`, 'POST', { receiverName, note }),

  requestAdvance: (input: {
    operatorId: string;
    shipmentId: string;
    amountEtb: number;
    channel: string;
  }) => request<FuelAdvance>('/advances', 'POST', input),
  transitionAdvance: (advanceId: string, action: string) =>
    request<FuelAdvance>(`/advances/${advanceId}/transition`, 'POST', { action }),
  listAdvances: () => request<FuelAdvance[]>('/advances', 'GET'),

  createInvoice: (shipmentId: string, shipperTin: string, operatorTin: string) =>
    request<VatInvoice>('/invoices', 'POST', { shipmentId, shipperTin, operatorTin }),

  getMetrics: () => request<MarketplaceMetrics>('/metrics', 'GET'),

  replay: (path: string, body: unknown) => request(path, 'POST', body),

  chat: (
    message: string,
    ctx: { shipperId?: string; operatorId?: string } = {},
    lang?: string,
  ) =>
    request<AgentResult>('/agent/chat', 'POST', {
      message,
      sessionId: getSessionId(),
      ...(lang ? { lang } : {}),
      ...ctx,
    }),
};
