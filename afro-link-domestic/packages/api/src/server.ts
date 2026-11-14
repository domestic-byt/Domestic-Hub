import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { AdvanceChannel, PayoutAdapter } from '@afro-link/shared';
import { DomesticAgent, LlmAdapter, MistralLlmAdapter } from '@afro-link/agent';
import { InMemoryRepo, MarketplaceRepo } from './repo';
import { PgRepo } from './repo-pg';
import { MarketplaceStore } from './store';
import { payoutAdaptersFromEnv } from './payouts-live';
import { loadRoutes, operatorRoutes } from './routes/loads';
import { shipmentRoutes } from './routes/shipments';
import { advanceRoutes } from './routes/advances';
import { invoiceRoutes } from './routes/invoices';
import { agentRoutes } from './routes/agent';
import { metricsRoutes } from './routes/metrics';
import { webhookRoutes } from './routes/webhooks';
import { marketRoutes } from './routes/market';
import { adminRoutes } from './routes/admin';
import { WebhookDispatcher } from './webhooks';
import { AuthConfig, authenticate } from './auth';

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

export async function resolveRepo(explicit?: MarketplaceRepo): Promise<MarketplaceRepo> {
  if (explicit) {
    await explicit.initialize();
    return explicit;
  }
  if (process.env.DATABASE_URL) {
    return PgRepo.connect(process.env.DATABASE_URL);
  }
  return new InMemoryRepo();
}

export async function buildServer(options?: {
  payouts?: Record<AdvanceChannel, PayoutAdapter>;
  llm?: LlmAdapter;
  repo?: MarketplaceRepo;
  auth?: AuthConfig;
}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const repo = await resolveRepo(options?.repo);
  const webhooks = new WebhookDispatcher(repo);
  const store = new MarketplaceStore(
    repo,
    options?.payouts ?? payoutAdaptersFromEnv(),
    webhooks,
  );
  const auth =
    options?.auth ??
    (process.env.AUTH_SECRET ? { secret: process.env.AUTH_SECRET } : undefined);
  const llm =
    options?.llm ??
    (process.env.MISTRAL_API_KEY
      ? new MistralLlmAdapter({ apiKey: process.env.MISTRAL_API_KEY })
      : undefined);
  const agent = new DomesticAgent(store, llm);
  const origins = allowedOrigins();

  app.register(cors, {
    origin: (origin, cb) => cb(null, !origin || origins.includes(origin)),
  });

  app.decorate('authSecret', auth?.secret);
  app.decorateRequest('actor');
  if (auth) {
    app.addHook('preHandler', authenticate(auth));
  }

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
  app.register(async (instance) => metricsRoutes(instance, store));
  app.register(async (instance) => webhookRoutes(instance, repo));
  app.register(async (instance) => marketRoutes(instance, store));
  app.register(async (instance) => adminRoutes(instance, store));

  app.addHook('onClose', async () => {
    await repo.close();
  });

  return app;
}

const isDirectRun = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!);

if (isDirectRun) {
  const port = Number(process.env.PORT ?? 3000);
  buildServer()
    .then((app) => app.listen({ port, host: '127.0.0.1' }))
    .then((address) => console.log(`afro-link-domestic api listening on ${address}`))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
