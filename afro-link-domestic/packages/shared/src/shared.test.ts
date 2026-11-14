import { describe, expect, it } from 'vitest';
import { rankOperatorsForLoad } from '../src/domain/matching';
import { suggestPrice } from '../src/domain/pricing';
import { computeVat, ETHIOPIAN_VAT_RATE } from '../src/domain/vat';
import {
  nextAdvanceStatus,
  validateAdvanceRequest,
} from '../src/domain/advances';
import { City, Load, TruckOperator } from '../src/index';

const addis: City = { name: 'Addis Ababa', lat: 9.03, lon: 38.74 };
const jimma: City = { name: 'Jimma', lat: 7.67, lon: 36.83 };
const bahirDar: City = { name: 'Bahir Dar', lat: 11.59, lon: 37.39 };
const mekelle: City = { name: 'Mekelle', lat: 13.5, lon: 39.47 };

function makeLoad(overrides: Partial<Load> = {}): Load {
  return {
    id: 'load-1',
    shipperId: 'shipper-1',
    origin: jimma,
    destination: addis,
    weightTons: 20,
    availableFrom: '2025-01-10T08:00:00Z',
    offeredPriceEtb: 40000,
    status: 'open',
    ...overrides,
  };
}

function makeOperator(overrides: Partial<TruckOperator> = {}): TruckOperator {
  return {
    id: 'op-1',
    name: 'Abebe Trucks',
    phone: '+251911000000',
    truckPlate: 'AA-12345',
    capacityTons: 25,
    currentCity: bahirDar,
    status: 'available',
    ...overrides,
  };
}

describe('rankOperatorsForLoad', () => {
  it('filters out operators with insufficient capacity', () => {
    const matches = rankOperatorsForLoad(makeLoad(), [
      makeOperator({ id: 'small', capacityTons: 10 }),
      makeOperator({ id: 'big', capacityTons: 30 }),
    ]);
    expect(matches.map((m) => m.operatorId)).toEqual(['big']);
  });

  it('prefers the operator whose last drop-off is nearest the pickup', () => {
    const near = makeOperator({ id: 'near', lastDropOffCity: jimma });
    const far = makeOperator({ id: 'far', lastDropOffCity: mekelle });
    const matches = rankOperatorsForLoad(makeLoad(), [far, near]);
    expect(matches[0]!.operatorId).toBe('near');
    expect(matches[0]!.deadheadKm).toBeLessThan(matches[1]!.deadheadKm);
    expect(matches[0]!.reasons).toContain('minimal empty repositioning to pickup');
  });

  it('falls back to current city when there is no last drop-off', () => {
    const op = makeOperator({ id: 'op', currentCity: jimma });
    const matches = rankOperatorsForLoad(makeLoad(), [op]);
    expect(matches[0]!.deadheadKm).toBe(0);
  });

  it('flags trucks based near the destination as backhaul candidates', () => {
    const op = makeOperator({ id: 'op', currentCity: addis, lastDropOffCity: jimma });
    const matches = rankOperatorsForLoad(makeLoad(), [op]);
    expect(matches[0]!.reasons.join(' ')).toMatch(/empty return/);
  });
});

describe('computeVat', () => {
  it('applies the 15% Ethiopian VAT rate', () => {
    expect(ETHIOPIAN_VAT_RATE).toBe(0.15);
    expect(computeVat(40000)).toEqual({
      subtotalEtb: 40000,
      vatEtb: 6000,
      totalEtb: 46000,
    });
  });

  it('rounds to two decimals', () => {
    const result = computeVat(1234.567);
    expect(result.vatEtb).toBe(185.19);
    expect(result.totalEtb).toBe(1419.76);
  });
});

describe('advance state machine', () => {
  it('walks the happy path requested -> approved -> disbursed -> recovered', () => {
    expect(nextAdvanceStatus('requested', 'approve')).toBe('approved');
    expect(nextAdvanceStatus('approved', 'disburse')).toBe('disbursed');
    expect(nextAdvanceStatus('disbursed', 'recover')).toBe('recovered');
  });

  it('rejects invalid transitions', () => {
    expect(nextAdvanceStatus('requested', 'disburse')).toBeNull();
    expect(nextAdvanceStatus('recovered', 'default')).toBeNull();
  });
});

describe('validateAdvanceRequest', () => {
  it('accepts a valid request within the cap', () => {
    const errors = validateAdvanceRequest({
      amountEtb: 8000,
      load: makeLoad({ status: 'assigned' }),
      activeAdvances: [],
    });
    expect(errors).toEqual([]);
  });

  it('rejects amounts above 20% of the load price', () => {
    const errors = validateAdvanceRequest({
      amountEtb: 9000,
      load: makeLoad({ status: 'assigned' }),
      activeAdvances: [],
    });
    expect(errors[0]).toMatch(/20% cap/);
  });

  it('rejects when the operator already has an active advance', () => {
    const active = {
      id: 'adv-1',
      operatorId: 'op-1',
      shipmentId: 'ship-1',
      amountEtb: 1000,
      channel: 'telebirr' as const,
      status: 'disbursed' as const,
      requestedAt: '2025-01-10T08:00:00Z',
    };
    const errors = validateAdvanceRequest({
      amountEtb: 1000,
      load: makeLoad({ status: 'assigned' }),
      activeAdvances: [active],
    });
    expect(errors.join(' ')).toMatch(/active fuel advance/);
  });

  it('rejects advances on open or cancelled loads', () => {
    const errors = validateAdvanceRequest({
      amountEtb: 1000,
      load: makeLoad({ status: 'open' }),
      activeAdvances: [],
    });
    expect(errors.join(' ')).toMatch(/assigned or delivered/);
  });
});

describe('lane price benchmarking', () => {
  const deliveredLane = [
    makeLoad({ id: 'l1', status: 'delivered', offeredPriceEtb: 40000 }),
    makeLoad({ id: 'l2', status: 'delivered', offeredPriceEtb: 44000 }),
    makeLoad({ id: 'l3', status: 'delivered', offeredPriceEtb: 48000 }),
  ];

  it('suggests a price from delivered lane history', () => {
    const suggestion = suggestPrice(deliveredLane, {
      origin: jimma,
      destination: addis,
      weightTons: 20,
    });
    expect(suggestion).not.toBeNull();
    expect(suggestion!.basis).toBe('lane');
    expect(suggestion!.sampleSize).toBe(3);
    expect(suggestion!.suggestedEtb).toBeGreaterThan(0);
    expect(suggestion!.lowEtb).toBeLessThan(suggestion!.suggestedEtb);
    expect(suggestion!.highEtb).toBeGreaterThan(suggestion!.suggestedEtb);
  });

  it('falls back to the network median when the lane has few deliveries', () => {
    const otherLane = [
      makeLoad({ id: 'n1', status: 'delivered', origin: bahirDar, destination: mekelle, offeredPriceEtb: 50000 }),
    ];
    const suggestion = suggestPrice([...otherLane, ...deliveredLane.slice(0, 2)], {
      origin: bahirDar,
      destination: mekelle,
      weightTons: 10,
    });
    expect(suggestion).not.toBeNull();
    expect(suggestion!.basis).toBe('network');
  });

  it('returns null with no delivered history', () => {
    expect(suggestPrice([makeLoad()], { origin: jimma, destination: addis, weightTons: 20 })).toBeNull();
  });
});
