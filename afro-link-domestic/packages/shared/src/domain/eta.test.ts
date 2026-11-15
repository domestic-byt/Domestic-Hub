import { describe, expect, it } from 'vitest';
import { estimateEta, AVG_SPEED_KMH, LOADING_HOURS } from './eta';
import { City, Shipment, TrackingEvent } from './types';

const addis: City = { name: 'Addis Ababa', lat: 9.03, lon: 38.74 };
const jimma: City = { name: 'Jimma', lat: 7.67, lon: 36.83 };
const shashamane: City = { name: 'Shashamane', lat: 7.2, lon: 38.6 };

function shipment(overrides: Partial<Shipment> = {}): Shipment {
  return {
    id: 'shp-1',
    loadId: 'load-1',
    operatorId: 'op-1',
    assignedAt: '2025-01-10T08:00:00.000Z',
    deliveredAt: undefined,
    status: 'assigned',
    ...overrides,
  };
}

describe('estimateEta', () => {
  it('returns no ETA for cancelled shipments', () => {
    expect(
      estimateEta({ shipment: shipment({ status: 'cancelled' }), origin: jimma, destination: addis }),
    ).toBeUndefined();
  });

  it('reports zero remaining distance for delivered shipments', () => {
    const eta = estimateEta({
      shipment: shipment({ status: 'delivered', deliveredAt: '2025-01-11T10:00:00.000Z' }),
      origin: jimma,
      destination: addis,
    });
    expect(eta?.remainingKm).toBe(0);
    expect(eta?.hoursRemaining).toBe(0);
    expect(eta?.etaAt).toBe('2025-01-11T10:00:00.000Z');
    expect(eta!.totalKm).toBeGreaterThan(200);
  });

  it('adds loading time for assigned shipments and uses the latest located event', () => {
    const events: TrackingEvent[] = [
      { shipmentId: 'shp-1', at: '2025-01-10T09:00:00.000Z', kind: 'picked_up', location: jimma },
      { shipmentId: 'shp-1', at: '2025-01-10T14:00:00.000Z', kind: 'at_checkpoint', location: shashamane },
    ];
    const now = new Date('2025-01-10T15:00:00.000Z');
    const eta = estimateEta({
      shipment: shipment({ status: 'in_transit' }),
      origin: jimma,
      destination: addis,
      events,
      now,
    });
    const direct = estimateEta({
      shipment: shipment({ status: 'in_transit' }),
      origin: jimma,
      destination: addis,
      now,
    });
    expect(eta!.remainingKm).toBeLessThan(direct!.remainingKm);
    expect(eta!.hoursRemaining).toBeCloseTo(eta!.remainingKm / AVG_SPEED_KMH, 1);
    expect(direct!.hoursRemaining).toBeCloseTo(direct!.remainingKm / AVG_SPEED_KMH, 1);

    const assigned = estimateEta({
      shipment: shipment({ status: 'assigned' }),
      origin: jimma,
      destination: addis,
      now,
    });
    expect(assigned!.hoursRemaining).toBeCloseTo(assigned!.remainingKm / AVG_SPEED_KMH + LOADING_HOURS, 1);
    expect(new Date(assigned!.etaAt).getTime()).toBe(now.getTime() + assigned!.hoursRemaining * 3_600_000);
  });
});
