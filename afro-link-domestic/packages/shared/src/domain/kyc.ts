import { TruckOperator } from './types';

export type KycDocuments = Pick<TruckOperator, 'licenseExpiry' | 'insuranceExpiry'>;

export type KycStatus = 'unverified' | 'valid' | 'expired';

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

export function kycStatus(operator: KycDocuments, now: Date = new Date()): KycStatus {
  if (!operator.licenseExpiry && !operator.insuranceExpiry) return 'unverified';
  return kycIssues(operator, now).length === 0 ? 'valid' : 'expired';
}
