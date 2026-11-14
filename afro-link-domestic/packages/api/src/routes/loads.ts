import { FastifyInstance, FastifyReply } from 'fastify';
import { City, DomainError } from '@afro-link/shared';
import { MarketplaceStore } from '../store';
import { guard } from '../auth';

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

export async function run<T>(
  reply: FastifyReply,
  fn: () => T | Promise<T>,
  successStatus?: number,
): Promise<T | FastifyReply> {
  try {
    const result = await fn();
    return successStatus === undefined ? result : reply.code(successStatus).send(result);
  } catch (err) {
    if (!(err instanceof DomainError)) throw err;
    if (err.code === 'validation') {
      return reply.code(422).send({ errors: err.issues });
    }
    const status = err.code === 'not_found' ? 404 : 409;
    return reply.code(status).send({ error: err.message });
  }
}

interface TruckOperatorBody {
  name: string;
  phone: string;
  truckPlate: string;
  capacityTons: number;
  currentCity: City;
  lastDropOffCity?: City;
}

interface LoadBody {
  shipperId: string;
  origin: City;
  destination: City;
  weightTons: number;
  offeredPriceEtb: number;
  availableFrom?: string;
}

export async function operatorRoutes(app: FastifyInstance, store: MarketplaceStore) {
  app.get('/operators', async () => store.listOperators());

  app.post('/operators', async (request, reply) => {
    if (guard(request, reply, 'operator', 'admin')) return;
    const body = request.body as Partial<TruckOperatorBody> | null;
    if (!body || !body.name || !body.phone || !body.truckPlate) {
      return reply.code(400).send({ error: 'name, phone and truckPlate are required.' });
    }
    if (!isCity(body.currentCity)) {
      return reply.code(400).send({ error: 'currentCity must be a City {name, lat, lon}.' });
    }
    if (typeof body.capacityTons !== 'number' || body.capacityTons <= 0) {
      return reply.code(400).send({ error: 'capacityTons must be a positive number.' });
    }
    const lastDropOffCity = body.lastDropOffCity;
    return run(
      reply,
      () =>
        store.createOperator({
        name: body.name!,
        phone: body.phone!,
        truckPlate: body.truckPlate!,
        capacityTons: body.capacityTons!,
        currentCity: body.currentCity!,
        lastDropOffCity: isCity(lastDropOffCity) ? lastDropOffCity : undefined,
      }),
      201,
    );
  });
}

export async function loadRoutes(app: FastifyInstance, store: MarketplaceStore) {
  app.get('/loads', async () => store.listLoads());

  app.post('/loads', async (request, reply) => {
    if (guard(request, reply, 'shipper', 'admin')) return;
    const body = request.body as Partial<LoadBody> | null;
    if (!body || !body.shipperId) {
      return reply.code(400).send({ error: 'shipperId is required.' });
    }
    if (!isCity(body.origin) || !isCity(body.destination)) {
      return reply.code(400).send({ error: 'origin and destination must be a City {name, lat, lon}.' });
    }
    if (typeof body.weightTons !== 'number' || body.weightTons <= 0) {
      return reply.code(400).send({ error: 'weightTons must be a positive number.' });
    }
    if (typeof body.offeredPriceEtb !== 'number' || body.offeredPriceEtb <= 0) {
      return reply.code(400).send({ error: 'offeredPriceEtb must be a positive number.' });
    }
    const actor = request.actor;
    return run(
      reply,
      () =>
        store.createLoad({
          shipperId: actor?.role === 'shipper' ? actor.subject : body.shipperId!,
          origin: body.origin!,
          destination: body.destination!,
          weightTons: body.weightTons!,
          offeredPriceEtb: body.offeredPriceEtb!,
          availableFrom: body.availableFrom,
        }),
      201,
    );
  });

  app.get('/loads/:id/matches', async (request, reply) => {
    const { id } = request.params as { id: string };
    return run(reply, () => store.rankMatches(id));
  });

  app.get('/operators/:id/return-loads', async (request, reply) => {
    const { id } = request.params as { id: string };
    return run(reply, () => store.rankReturnLoads(id));
  });
}
