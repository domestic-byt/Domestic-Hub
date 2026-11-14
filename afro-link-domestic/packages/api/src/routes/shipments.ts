import { FastifyInstance } from 'fastify';
import { City, TrackingEventKind } from '@afro-link/shared';
import { MarketplaceStore } from '../store';
import { guard } from '../auth';
import { run } from './loads';

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

export async function shipmentRoutes(app: FastifyInstance, store: MarketplaceStore) {
  app.get('/shipments', async () => store.listShipments());

  app.post('/shipments', async (request, reply) => {
    if (guard(request, reply, 'shipper', 'admin')) return;
    const body = request.body as { loadId?: string; operatorId?: string } | null;
    if (!body || !body.loadId || !body.operatorId) {
      return reply.code(400).send({ error: 'loadId and operatorId are required.' });
    }
    return run(reply, () => store.assignShipment(body.loadId!, body.operatorId!), 201);
  });

  app.post('/shipments/:id/events', async (request, reply) => {
    if (guard(request, reply, 'operator', 'admin')) return;
    const { id } = request.params as { id: string };
    const body = request.body as {
      kind?: unknown;
      location?: unknown;
      note?: unknown;
    } | null;
    if (!isEventKind(body?.kind)) {
      return reply
        .code(400)
        .send({ error: `kind must be one of: ${EVENT_KINDS.join(', ')}.` });
    }
    const location = body?.location;
    const note = typeof body?.note === 'string' ? body.note : undefined;
    return run(
      reply,
      () =>
        store.addTrackingEvent(
          id,
          body!.kind as TrackingEventKind,
          isCity(location) ? location : undefined,
          note,
        ),
      201,
    );
  });

  app.get('/shipments/:id/tracking', async (request, reply) => {
    const { id } = request.params as { id: string };
    return run(reply, () => store.getTracking(id));
  });
}
