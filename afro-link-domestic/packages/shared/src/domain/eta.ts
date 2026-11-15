import { City, Shipment, TrackingEvent } from './types';
import { haversineKm } from './geo';

export const AVG_SPEED_KMH = 40;
export const LOADING_HOURS = 2;

export interface ShipmentEta {
  remainingKm: number;
  totalKm: number;
  hoursRemaining: number;
  etaAt: string;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function estimateEta(input: {
  shipment: Shipment;
  origin: City;
  destination: City;
  events?: TrackingEvent[];
  now?: Date;
}): ShipmentEta | undefined {
  const { shipment, origin, destination } = input;
  if (shipment.status === 'cancelled') return undefined;
  const totalKm = round1(haversineKm(origin, destination));
  if (shipment.status === 'delivered') {
    return {
      remainingKm: 0,
      totalKm,
      hoursRemaining: 0,
      etaAt: shipment.deliveredAt ?? (input.now ?? new Date()).toISOString(),
    };
  }
  const now = input.now ?? new Date();
  const located = (input.events ?? [])
    .filter((e) => e.location)
    .sort((a, b) => b.at.localeCompare(a.at))[0];
  const remainingKm = located ? haversineKm(located.location!, destination) : totalKm;
  const hoursRemaining = round1(
    remainingKm / AVG_SPEED_KMH + (shipment.status === 'assigned' ? LOADING_HOURS : 0),
  );
  return {
    remainingKm: round1(remainingKm),
    totalKm,
    hoursRemaining,
    etaAt: new Date(now.getTime() + hoursRemaining * 3_600_000).toISOString(),
  };
}
