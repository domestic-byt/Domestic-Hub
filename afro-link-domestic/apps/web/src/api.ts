import type {
  AgentResult,
  City,
  FuelAdvance,
  Load,
  Operator,
  OperatorMatch,
  Shipment,
  TrackingEvent,
  VatInvoice,
} from './types';

const API_BASE: string = import.meta.env.VITE_API_BASE ?? '/api';

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
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
  const res = await fetch(apiUrl(path), {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
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

  createShipment: (loadId: string, operatorId: string) =>
    request<Shipment>('/shipments', 'POST', { loadId, operatorId }),
  addTrackingEvent: (shipmentId: string, kind: string, location?: City) =>
    request<TrackingEvent>(`/shipments/${shipmentId}/events`, 'POST', { kind, location }),
  getTracking: (shipmentId: string) =>
    request<TrackingEvent[]>(`/shipments/${shipmentId}/tracking`, 'GET'),

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

  chat: (message: string, ctx: { shipperId?: string; operatorId?: string } = {}) =>
    request<AgentResult>('/agent/chat', 'POST', { message, ...ctx }),
};
