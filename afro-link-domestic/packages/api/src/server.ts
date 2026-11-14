import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { AdvanceChannel, PayoutAdapter } from '@afro-link/shared';
import { DomesticAgent } from '@afro-link/agent';
import { Repo } from './repo';
import { MarketplaceStore } from './store';
import { loadRoutes, operatorRoutes } from './routes/loads';
import { shipmentRoutes } from './routes/shipments';
import { advanceRoutes } from './routes/advances';
import { invoiceRoutes } from './routes/invoices';
import { agentRoutes } from './routes/agent';

export const DEFAULT_ALLOWED_ORIGINS = [
  'https://afro-link.domestic.com.et',
  'https://domestic.com.et',
  'https://domestic-hub.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000',
];

export function allowedOrigins(): string[] {
  const fromEnv = process.env.ALLOWED_ORIGINS?.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_ALLOWED_ORIGINS;
}

export function buildServer(options?: {
  payouts?: Record<AdvanceChannel, PayoutAdapter>;
}): FastifyInstance {
  const app = Fastify({ logger: false });
  const store = new MarketplaceStore(new Repo(), options?.payouts);
  const agent = new DomesticAgent(store);
  const origins = allowedOrigins();

  app.register(cors, {
    origin: (origin, cb) => cb(null, !origin || origins.includes(origin)),
  });

  app.get('/health', async () => ({
    status: 'ok',
    service: 'afro-link-domestic-api',
    domain: 'afro-link.domestic.com.et',
  }));
  app.register(async (instance) => operatorRoutes(instance, store));
  app.register(async (instance) => loadRoutes(instance, store));
  app.register(async (instance) => shipmentRoutes(instance, store));
  app.register(async (instance) => advanceRoutes(instance, store));
  app.register(async (instance) => invoiceRoutes(instance, store));
  app.register(async (instance) => agentRoutes(instance, agent));

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
