import { haversineKm } from './geo';
import { kycIssues, kycStatus } from './kyc';
import { Load, TruckOperator } from './types';

export interface OperatorMatch {
  operatorId: string;
  operatorName: string;
  score: number;
  deadheadKm: number;
  reasons: string[];
}

const DEADHEAD_PENALTY_PER_KM = 0.5;
const SLACK_PENALTY_PER_TON = 3;
const NEAR_DEADHEAD_KM = 25;
const NEAR_FIT_TONS = 2;
const BACKHAUL_RADIUS_KM = 100;
const ON_TRIP_PENALTY = 40;

export function rankOperatorsForLoad(
  load: Load,
  operators: TruckOperator[],
): OperatorMatch[] {
  return operators
    .filter((o) => o.capacityTons >= load.weightTons && kycIssues(o).length === 0)
    .map((o) => {
      const anchor = o.lastDropOffCity ?? o.currentCity;
      const deadheadKm = haversineKm(anchor, load.origin);
      const slackTons = o.capacityTons - load.weightTons;
      const reasons: string[] = [];
      let score = 100;

      score -= deadheadKm * DEADHEAD_PENALTY_PER_KM;
      score -= slackTons * SLACK_PENALTY_PER_TON;
      if (kycStatus(o) === 'unverified') {
        reasons.push('KYC documents not provided');
      }
      if (o.status === 'on_trip') {
        score -= ON_TRIP_PENALTY;
        reasons.push('currently on a trip');
      }
      if (deadheadKm < NEAR_DEADHEAD_KM) {
        reasons.push('minimal empty repositioning to pickup');
      }
      if (slackTons <= NEAR_FIT_TONS) {
        reasons.push('truck capacity closely matches load weight');
      }
      const homeNearDestination =
        haversineKm(o.currentCity, load.destination) < BACKHAUL_RADIUS_KM;
      if (homeNearDestination) {
        reasons.push('truck is based near the destination, cutting empty return risk');
      }

      return {
        operatorId: o.id,
        operatorName: o.name,
        score: Math.round(score * 100) / 100,
        deadheadKm: Math.round(deadheadKm * 10) / 10,
        reasons,
      };
    })
    .sort((a, b) => b.score - a.score);
}
