import Fastify, { FastifyInstance } from 'fastify';
import { Repo } from './repo';
import { loadRoutes, operatorRoutes } from './routes/loads';
import { shipmentRoutes } from './routes/shipments';
import { advanceRoutes } from './routes/advances';
import { invoiceRoutes } from './routes/invoices';

export function buildServer(): FastifyInstance {
  const app = Fastify({ logger: false });
  const repo = new Repo();

  app.get('/health', async () => ({ status: 'ok', service: 'afro-link-domestic-api' }));
  app.register(async (instance) => operatorRoutes(instance, repo));
  app.register(async (instance) => loadRoutes(instance, repo));
  app.register(async (instance) => shipmentRoutes(instance, repo));
  app.register(async (instance) => advanceRoutes(instance, repo));
  app.register(async (instance) => invoiceRoutes(instance, repo));

  return app;
}

const isDirectRun = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!);

if (isDirectRun) {
  const port = Number(process.env.PORT ?? 3000);
  buildServer()
    .listen({ port, host: '127.0.0.1' })
    .then((address) => console.log(`afro-link-domestic api listening on ${address}`))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
