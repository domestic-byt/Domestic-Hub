import { FastifyInstance } from 'fastify';
import { ETHIOPIAN_CITIES, City } from '@afro-link/shared';
import { MarketplaceStore } from '../store';

function resolveCity(name: string): City | undefined {
  const key = name.trim().toLowerCase();
  return (
    Object.values(ETHIOPIAN_CITIES).find((c) => c.name.toLowerCase() === key) ??
    Object.values(ETHIOPIAN_CITIES).find((c) => c.name.toLowerCase().startsWith(key))
  );
}

export async function marketRoutes(app: FastifyInstance, store: MarketplaceStore) {
  app.get('/markets/prices', async (request, reply) => {
    const query = request.query as {
      origin?: string;
      destination?: string;
      weightTons?: string;
    };
    if (!query.origin || !query.destination || !query.weightTons) {
      return reply
        .code(400)
        .send({ error: 'origin, destination and weightTons query params are required.' });
    }
    const origin = resolveCity(query.origin);
    const destination = resolveCity(query.destination);
    if (!origin || !destination) {
      return reply.code(404).send({ error: 'Unknown city name.' });
    }
    const weightTons = Number(query.weightTons);
    if (!Number.isFinite(weightTons) || weightTons <= 0) {
      return reply.code(400).send({ error: 'weightTons must be a positive number.' });
    }
    const suggestion = await store.suggestLanePrice({ origin, destination, weightTons });
    if (!suggestion) {
      return reply.code(404).send({ error: 'Not enough delivered loads to suggest a price yet.' });
    }
    return suggestion;
  });
}
