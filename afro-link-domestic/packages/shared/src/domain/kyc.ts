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
  expiring: string[];
}

export const KYC_EXPIRY_SOON_DAYS = 30;

export function kycExpiryWarnings(
  operator: KycDocuments,
  withinDays: number = KYC_EXPIRY_SOON_DAYS,
  now: Date = new Date(),
): string[] {
  const today = now.toISOString().slice(0, 10);
  const horizon = new Date(now.getTime() + withinDays * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const warnings: string[] = [];
  if (
    operator.licenseExpiry &&
    operator.licenseExpiry >= today &&
    operator.licenseExpiry <= horizon
  ) {
    warnings.push(`driving license expires on ${operator.licenseExpiry}`);
  }
  if (
    operator.insuranceExpiry &&
    operator.insuranceExpiry >= today &&
    operator.insuranceExpiry <= horizon
  ) {
    warnings.push(`insurance expires on ${operator.insuranceExpiry}`);
  }
  return warnings;
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
      expiring: kycExpiryWarnings(o, KYC_EXPIRY_SOON_DAYS, now),
    }))
    .sort(
      (a, b) =>
        KYC_QUEUE_RANK[a.status] - KYC_QUEUE_RANK[b.status] ||
        a.operatorName.localeCompare(b.operatorName),
    );
}
