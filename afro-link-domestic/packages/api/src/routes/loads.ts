import { FastifyInstance } from 'fastify';
import { City, Load, TruckOperator, rankOperatorsForLoad } from '@afro-link/shared';
import { Repo } from '../repo';

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

export async function operatorRoutes(app: FastifyInstance, repo: Repo) {
  app.get('/operators', async () => [...repo.operators.values()]);

  app.post('/operators', async (request, reply) => {
    const body = request.body as Partial<TruckOperator> | null;
    if (!body?.name || !body?.phone || !body?.truckPlate) {
      return reply.code(400).send({ error: 'name, phone and truckPlate are required.' });
    }
    if (!isCity(body.currentCity)) {
      return reply.code(400).send({ error: 'currentCity must be a City {name, lat, lon}.' });
    }
    if (typeof body.capacityTons !== 'number' || body.capacityTons <= 0) {
      return reply.code(400).send({ error: 'capacityTons must be a positive number.' });
    }
    const operator: TruckOperator = {
      id: crypto.randomUUID(),
      name: body.name,
      phone: body.phone,
      truckPlate: body.truckPlate,
      capacityTons: body.capacityTons,
      currentCity: body.currentCity,
      lastDropOffCity: isCity(body.lastDropOffCity) ? body.lastDropOffCity : undefined,
      status: 'available',
    };
    repo.operators.set(operator.id, operator);
    return reply.code(201).send(operator);
  });
}

export async function loadRoutes(app: FastifyInstance, repo: Repo) {
  app.get('/loads', async () => [...repo.loads.values()]);

  app.post('/loads', async (request, reply) => {
    const body = request.body as Partial<Load> | null;
    if (!body?.shipperId) {
      return reply.code(400).send({ error: 'shipperId is required.' });
    }
    if (!isCity(body.origin) || !isCity(body.destination)) {
      return reply.code(400).send({ error: 'origin and destination must be City {name, lat, lon}.' });
    }
    if (typeof body.weightTons !== 'number' || body.weightTons <= 0) {
      return reply.code(400).send({ error: 'weightTons must be a positive number.' });
    }
    if (typeof body.offeredPriceEtb !== 'number' || body.offeredPriceEtb <= 0) {
      return reply.code(400).send({ error: 'offeredPriceEtb must be a positive number.' });
    }
    const load: Load = {
      id: crypto.randomUUID(),
      shipperId: body.shipperId,
      origin: body.origin,
      destination: body.destination,
      weightTons: body.weightTons,
      availableFrom: body.availableFrom ?? new Date().toISOString(),
      offeredPriceEtb: body.offeredPriceEtb,
      status: 'open',
    };
    repo.loads.set(load.id, load);
    return reply.code(201).send(load);
  });

  app.get('/loads/:id/matches', async (request, reply) => {
    const { id } = request.params as { id: string };
    const load = repo.loads.get(id);
    if (!load) {
      return reply.code(404).send({ error: 'Load not found.' });
    }
    return rankOperatorsForLoad(load, [...repo.operators.values()]);
  });
}
