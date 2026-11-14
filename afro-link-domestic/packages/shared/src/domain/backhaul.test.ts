import { describe, expect, it } from 'vitest';
import { rankReturnLoads } from './backhaul';
import { City, Load, TruckOperator } from './types';

const addis: City = { name: 'Addis Ababa', lat: 9.03, lon: 38.74 };
const jimma: City = { name: 'Jimma', lat: 7.67, lon: 36.83 };
const adama: City = { name: 'Adama', lat: 8.54, lon: 39.27 };

const operator: TruckOperator = {
  id: 'op-1',
  name: 'Abebe Trucks',
  phone: '+251911000000',
  truckPlate: 'AA-12345',
  capacityTons: 25,
  currentCity: jimma,
  lastDropOffCity: jimma,
  status: 'available',
};

function load(overrides: Partial<Load> = {}): Load {
  return {
    id: 'load-1',
    shipperId: 'shipper-1',
    origin: jimma,
    destination: addis,
    weightTons: 20,
    availableFrom: '2025-01-10T08:00:00.000Z',
    offeredPriceEtb: 40000,
    status: 'open',
    ...overrides,
  };
}

describe('rankReturnLoads', () => {
  it('ranks loads picking up at the truck location highest', () => {
    const matches = rankReturnLoads(operator, [
      load({ id: 'away', origin: adama }),
      load({ id: 'here', origin: jimma, destination: addis }),
    ]);
    expect(matches[0]!.loadId).toBe('here');
    expect(matches[0]!.deadheadKm).toBe(0);
    expect(matches[0]!.reasons.join(' ')).toContain('no empty return leg');
  });

  it('skips assigned loads and overweight loads', () => {
    const matches = rankReturnLoads(operator, [
      load({ id: 'assigned', status: 'assigned' }),
      load({ id: 'too-heavy', weightTons: 30 }),
    ]);
    expect(matches).toEqual([]);
  });

  it('penalises deadhead distance and capacity slack', () => {
    const [near] = rankReturnLoads(operator, [load({ id: 'near', origin: jimma, weightTons: 24 })]);
    const [far] = rankReturnLoads(operator, [load({ id: 'far', origin: adama, weightTons: 10 })]);
    expect(near!.score).toBeGreaterThan(far!.score);
  });

  it('notes when pickup is near the last drop-off', () => {
    const [match] = rankReturnLoads(operator, [load({ origin: jimma })]);
    expect(match!.reasons.join(' ')).toContain('near the last drop-off');
  });
});
