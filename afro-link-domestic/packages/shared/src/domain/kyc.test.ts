import { describe, expect, it } from 'vitest';
import {
  kycExpiryWarnings,
  kycQueue,
  kycStatus,
  KYC_EXPIRY_SOON_DAYS,
} from './kyc';
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

  it('warns about documents expiring within the horizon', () => {
    const now = new Date('2026-06-15T12:00:00Z');
    expect(
      kycExpiryWarnings({ licenseExpiry: '2026-07-05' }, KYC_EXPIRY_SOON_DAYS, now),
    ).toEqual(['driving license expires on 2026-07-05']);
    expect(kycExpiryWarnings({ licenseExpiry: '2026-07-20' }, 30, now)).toEqual([]);
    expect(kycExpiryWarnings({ licenseExpiry: '2026-06-10' }, 30, now)).toEqual([]);
    expect(
      kycExpiryWarnings(
        { licenseExpiry: '2026-06-20', insuranceExpiry: '2027-01-01' },
        30,
        now,
      ),
    ).toEqual(['driving license expires on 2026-06-20']);
  });

  it('flags expiring documents in the review queue', () => {
    const now = new Date('2026-06-15T12:00:00Z');
    const queue = kycQueue(
      [operator('soon', 'Soon Op', { licenseExpiry: '2026-07-01' })],
      now,
    );
    expect(queue[0]!.expiring).toEqual(['driving license expires on 2026-07-01']);
    expect(queue[0]!.status).toBe('valid');
  });
});
