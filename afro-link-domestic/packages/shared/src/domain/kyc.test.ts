import { describe, expect, it } from 'vitest';
import { kycQueue, kycStatus } from './kyc';
import { TruckOperator } from './types';

const addis = { name: 'Addis Ababa', lat: 9.03, lon: 38.74 };

function operator(id: string, name: string, extra: Partial<TruckOperator> = {}): TruckOperator {
  return {
    id,
    name,
    phone: '+251911000000',
    truckPlate: `AA-${id}`,
    capacityTons: 30,
    currentCity: addis,
    status: 'available',
    ...extra,
  };
}

describe('kyc review', () => {
  it('marks rejected operators regardless of their documents', () => {
    expect(kycStatus({ licenseExpiry: '2030-01-01', kycDecision: 'rejected' })).toBe('rejected');
    expect(kycStatus({ licenseExpiry: '2030-01-01' })).toBe('valid');
    expect(kycStatus({})).toBe('unverified');
  });

  it('orders the review queue by severity and reports issues', () => {
    const queue = kycQueue([
      operator('valid', 'Valid Op', { licenseExpiry: '2030-01-01' }),
      operator('expired', 'Expired Op', { licenseExpiry: '2020-01-01' }),
      operator('pending', 'Pending Op'),
      operator('rejected', 'Rejected Op', { licenseExpiry: '2030-01-01', kycDecision: 'rejected' }),
    ]);
    expect(queue.map((r) => r.operatorId)).toEqual(['expired', 'rejected', 'pending', 'valid']);
    expect(queue[0]!.issues[0]).toMatch(/license expired on 2020-01-01/);
    expect(queue[0]!.status).toBe('expired');
    expect(queue.find((r) => r.operatorId === 'pending')!.decision).toBe('pending');
    expect(queue.find((r) => r.operatorId === 'rejected')!.status).toBe('rejected');
  });
});
