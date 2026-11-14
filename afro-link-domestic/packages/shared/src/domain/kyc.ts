import { KycDecision, TruckOperator } from './types';

export type KycDocuments = Pick<TruckOperator, 'licenseExpiry' | 'insuranceExpiry'>;

export type KycStatus = 'unverified' | 'valid' | 'expired' | 'rejected';

export type KycReviewable = KycDocuments & { kycDecision?: KycDecision };

export function kycIssues(operator: KycDocuments, now: Date = new Date()): string[] {
  const issues: string[] = [];
  const today = now.toISOString().slice(0, 10);
  if (operator.licenseExpiry && operator.licenseExpiry < today) {
    issues.push(`driving license expired on ${operator.licenseExpiry}`);
  }
  if (operator.insuranceExpiry && operator.insuranceExpiry < today) {
    issues.push(`insurance expired on ${operator.insuranceExpiry}`);
  }
  return issues;
}

export function kycStatus(operator: KycReviewable, now: Date = new Date()): KycStatus {
  if (operator.kycDecision === 'rejected') return 'rejected';
  if (!operator.licenseExpiry && !operator.insuranceExpiry) return 'unverified';
  return kycIssues(operator, now).length === 0 ? 'valid' : 'expired';
}

export interface KycReview {
  operatorId: string;
  operatorName: string;
  truckPlate: string;
  licenseExpiry?: string;
  insuranceExpiry?: string;
  decision: KycDecision;
  status: KycStatus;
  issues: string[];
}

const KYC_QUEUE_RANK: Record<KycStatus, number> = {
  expired: 0,
  rejected: 1,
  unverified: 2,
  valid: 3,
};

export function kycQueue(operators: TruckOperator[], now: Date = new Date()): KycReview[] {
  return operators
    .map((o) => ({
      operatorId: o.id,
      operatorName: o.name,
      truckPlate: o.truckPlate,
      licenseExpiry: o.licenseExpiry,
      insuranceExpiry: o.insuranceExpiry,
      decision: o.kycDecision ?? ('pending' as KycDecision),
      status: kycStatus(o, now),
      issues: kycIssues(o, now),
    }))
    .sort(
      (a, b) =>
        KYC_QUEUE_RANK[a.status] - KYC_QUEUE_RANK[b.status] ||
        a.operatorName.localeCompare(b.operatorName),
    );
}
