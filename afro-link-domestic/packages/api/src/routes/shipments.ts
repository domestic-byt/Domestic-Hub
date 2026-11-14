import { FastifyInstance } from 'fastify';
import {
  City,
  Load,
  Shipment,
  TrackingEvent,
  TrackingEventKind,
  TruckOperator,
} from '@afro-link/shared';
import { Repo } from '../repo';

const EVENT_KINDS: TrackingEventKind[] = [
  'assigned',
  'picked_up',
  'in_transit',
  'at_checkpoint',
  'delivered',
];

function isEventKind(value: unknown): value is TrackingEventKind {
  return typeof value === 'string' && (EVENT_KINDS as string[]).includes(value);
}

function isCity(value: unknown): value is City {
  const v = value as City;
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof v.name === 'string' &&
    typeof v.lat === 'number' &&
    typeof v.lon === 'number'
  );
}

export async function shipmentRoutes(app: FastifyInstance, repo: Repo) {
  app.get('/shipments', async () => [...repo.shipments.values()]);

  app.post('/shipments', async (request, reply) => {
    const body = request.body as { loadId?: string; operatorId?: string } | null;
    if (!body?.loadId || !body?.operatorId) {
      return reply.code(400).send({ error: 'loadId and operatorId are required.' });
    }
    const load = repo.loads.get(body.loadId);
    if (!load) {
      return reply.code(404).send({ error: 'Load not found.' });
    }
    if (load.status !== 'open') {
      return reply.code(409).send({ error: `Load is ${load.status}, not open.` });
    }
    const operator = repo.operators.get(body.operatorId);
    if (!operator) {
      return reply.code(404).send({ error: 'Operator not found.' });
    }
    if (operator.capacityTons < load.weightTons) {
      return reply.code(409).send({ error: 'Operator capacity is below load weight.' });
    }

    const shipment: Shipment = {
      id: crypto.randomUUID(),
      loadId: load.id,
      operatorId: operator.id,
      assignedAt: new Date().toISOString(),
      status: 'assigned',
    };
    repo.shipments.set(shipment.id, shipment);
    repo.loads.set(load.id, { ...load, status: 'assigned' });
    repo.operators.set(operator.id, { ...operator, status: 'on_trip' });
    repo.tracking.set(shipment.id, [
      {
        shipmentId: shipment.id,
        at: shipment.assignedAt,
        kind: 'assigned',
        location: load.origin,
        note: `Assigned to ${operator.name} (${operator.truckPlate}).`,
      },
    ]);
    return reply.code(201).send(shipment);
  });

  app.post('/shipments/:id/events', async (request, reply) => {
    const { id } = request.params as { id: string };
    const shipment = repo.shipments.get(id);
    if (!shipment) {
      return reply.code(404).send({ error: 'Shipment not found.' });
    }
    const body = request.body as {
      kind?: unknown;
      location?: unknown;
      note?: unknown;
    } | null;
    if (!isEventKind(body?.kind)) {
      return reply.code(400).send({ error: `kind must be one of: ${EVENT_KINDS.join(', ')}.` });
    }
    const event: TrackingEvent = {
      shipmentId: id,
      at: new Date().toISOString(),
      kind: body.kind,
      location: isCity(body?.location) ? body.location : undefined,
      note: typeof body?.note === 'string' ? body.note : undefined,
    };
    const events = repo.tracking.get(id) ?? [];
    events.push(event);
    repo.tracking.set(id, events);

    if (event.kind === 'picked_up') {
      repo.shipments.set(id, { ...shipment, status: 'in_transit' });
    }
    if (event.kind === 'delivered') {
      const delivered: Shipment = {
        ...shipment,
        status: 'delivered',
        deliveredAt: event.at,
      };
      repo.shipments.set(id, delivered);
      const load = repo.loads.get(shipment.loadId);
      if (load) {
        repo.loads.set(load.id, { ...load, status: 'delivered' } satisfies Load);
      }
      const operator = repo.operators.get(shipment.operatorId);
      if (operator) {
        repo.operators.set(operator.id, {
          ...operator,
          status: 'available',
          currentCity: event.location ?? load?.destination ?? operator.currentCity,
          lastDropOffCity: event.location ?? load?.destination,
        } satisfies TruckOperator);
      }
    }
    return reply.code(201).send(event);
  });

  app.get('/shipments/:id/tracking', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!repo.shipments.has(id)) {
      return reply.code(404).send({ error: 'Shipment not found.' });
    }
    return repo.tracking.get(id) ?? [];
  });
}
