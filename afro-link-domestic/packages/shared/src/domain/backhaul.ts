import { haversineKm } from './geo';
import { Load, TruckOperator } from './types';

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

const DEADHEAD_PENALTY_PER_KM = 0.5;
const SLACK_PENALTY_PER_TON = 3;
const ZERO_DEADHEAD_KM = 25;
const NEAR_LAST_DROP_OFF_KM = 50;
const NEAR_FIT_TONS = 2;
const ZERO_DEADHEAD_BONUS = 15;

export function rankReturnLoads(
  operator: TruckOperator,
  loads: Load[],
): ReturnLoadMatch[] {
  return loads
    .filter((l) => l.status === 'open' && operator.capacityTons >= l.weightTons)
    .map((load) => {
      const deadheadKm = haversineKm(operator.currentCity, load.origin);
      const slackTons = operator.capacityTons - load.weightTons;
      const reasons: string[] = [];
      let score = 100;

      score -= deadheadKm * DEADHEAD_PENALTY_PER_KM;
      score -= slackTons * SLACK_PENALTY_PER_TON;
      if (deadheadKm < ZERO_DEADHEAD_KM) {
        score += ZERO_DEADHEAD_BONUS;
        reasons.push('pickup is where the truck already stands — no empty return leg');
      }
      if (
        operator.lastDropOffCity &&
        haversineKm(operator.lastDropOffCity, load.origin) < NEAR_LAST_DROP_OFF_KM
      ) {
        reasons.push('pickup is near the last drop-off');
      }
      if (slackTons <= NEAR_FIT_TONS) {
        reasons.push('truck capacity closely matches load weight');
      }

      return {
        loadId: load.id,
        origin: load.origin.name,
        destination: load.destination.name,
        weightTons: load.weightTons,
        offeredPriceEtb: load.offeredPriceEtb,
        deadheadKm: Math.round(deadheadKm * 10) / 10,
        score: Math.round(score * 100) / 100,
        reasons,
      };
    })
    .sort((a, b) => b.score - a.score);
}
