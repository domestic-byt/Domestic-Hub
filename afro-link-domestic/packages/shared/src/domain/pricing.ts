import { haversineKm } from './geo';
import { City, Load } from './types';

export interface PriceSuggestion {
  etbPerTonKm: number;
  suggestedEtb: number;
  lowEtb: number;
  highEtb: number;
  distanceKm: number;
  sampleSize: number;
  basis: 'lane' | 'network';
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function ratesFor(loads: Load[], origin: City, destination: City): number[] {
  return loads
    .filter(
      (l) =>
        l.status === 'delivered' &&
        l.origin.name === origin.name &&
        l.destination.name === destination.name,
    )
    .map((l) => l.offeredPriceEtb / (l.weightTons * haversineKm(l.origin, l.destination)))
    .filter((rate) => Number.isFinite(rate) && rate > 0);
}

function roundEtb(value: number): number {
  return Math.round(value / 100) * 100;
}

export function suggestPrice(
  loads: Load[],
  input: { origin: City; destination: City; weightTons: number },
): PriceSuggestion | null {
  const distanceKm = haversineKm(input.origin, input.destination);
  if (distanceKm <= 0 || input.weightTons <= 0) return null;
  const laneRates = ratesFor(loads, input.origin, input.destination);
  const networkRates = loads
    .filter((l) => l.status === 'delivered')
    .map((l) => l.offeredPriceEtb / (l.weightTons * haversineKm(l.origin, l.destination)))
    .filter((rate) => Number.isFinite(rate) && rate > 0);
  const rates = laneRates.length >= 3 ? laneRates : networkRates;
  if (rates.length === 0) return null;
  const etbPerTonKm = Math.round(median(rates) * 100) / 100;
  const suggestedEtb = roundEtb(etbPerTonKm * input.weightTons * distanceKm);
  return {
    etbPerTonKm,
    suggestedEtb,
    lowEtb: roundEtb(suggestedEtb * 0.9),
    highEtb: roundEtb(suggestedEtb * 1.1),
    distanceKm: Math.round(distanceKm * 10) / 10,
    sampleSize: rates.length,
    basis: rates === laneRates ? 'lane' : 'network',
  };
}
