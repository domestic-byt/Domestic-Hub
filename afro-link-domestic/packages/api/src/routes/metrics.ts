import { FastifyInstance } from 'fastify';
import { MarketplaceStore } from '../store';
import { guard } from '../auth';

export async function metricsRoutes(app: FastifyInstance, store: MarketplaceStore) {
  app.get('/metrics', async (request, reply) => {
    if (guard(request, reply, 'admin')) return;
    return store.getMetrics();
  });
}
