import { FastifyInstance } from 'fastify';
import { DomainError, Webhook, WebhookEvent } from '@afro-link/shared';
import { MarketplaceRepo } from '../repo';
import { guard } from '../auth';
import { run } from './loads';
import { WebhookDispatcher } from '../webhooks';

const VALID_EVENTS: WebhookEvent[] = [
  'shipment.assigned',
  'shipment.picked_up',
  'shipment.delivered',
  'load.cancelled',
  'operator.kyc_expiring',
];

function isWebhookEvent(value: unknown): value is WebhookEvent {
  return typeof value === 'string' && (VALID_EVENTS as string[]).includes(value);
}

export function publicWebhook(webhook: Webhook) {
  return { ...webhook, secret: undefined };
}

export async function webhookRoutes(
  app: FastifyInstance,
  repo: MarketplaceRepo,
  dispatcher: WebhookDispatcher,
) {
  app.post('/webhooks', async (request, reply) => {
    if (guard(request, reply, 'shipper', 'operator', 'admin')) return;
    const body = request.body as { url?: string; events?: unknown; secret?: string } | null;
    if (!body || !body.url) {
      return reply.code(400).send({ error: 'url is required.' });
    }
    let parsed: URL;
    try {
      parsed = new URL(body.url);
    } catch {
      return reply.code(400).send({ error: 'url must be a valid absolute URL.' });
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return reply.code(400).send({ error: 'url must be http(s).' });
    }
    const events = Array.isArray(body.events) ? body.events : [];
    if (!events.every(isWebhookEvent)) {
      return reply.code(400).send({
        error: `events must be a subset of ${VALID_EVENTS.join(', ')}.`,
      });
    }
    const webhook: Webhook = {
      id: crypto.randomUUID(),
      url: body.url,
      secret: body.secret ?? crypto.randomUUID(),
      events,
      ownerId: request.actor?.subject,
      createdAt: new Date().toISOString(),
    };
    await repo.saveWebhook(webhook);
    return reply.code(201).send(webhook);
  });

  app.get('/webhooks', async (request, reply) => {
    if (guard(request, reply, 'admin')) return;
    return (await repo.listWebhooks()).map(publicWebhook);
  });

  app.delete('/webhooks/:id', async (request, reply) => {
    if (guard(request, reply, 'admin')) return;
    const { id } = request.params as { id: string };
    return run(reply, async () => {
      const hooks = await repo.listWebhooks();
      if (!hooks.some((h) => h.id === id)) {
        throw new DomainError('not_found', 'Webhook not found.');
      }
      await repo.deleteWebhook(id);
      return { ok: true };
    });
  });

  app.get('/webhooks/:id/deliveries', async (request, reply) => {
    if (guard(request, reply, 'admin')) return;
    const { id } = request.params as { id: string };
    return run(reply, async () => {
      const hooks = await repo.listWebhooks();
      if (!hooks.some((h) => h.id === id)) {
        throw new DomainError('not_found', 'Webhook not found.');
      }
      return repo.listDeliveries(id);
    });
  });

  app.post('/webhooks/deliveries/:id/retry', async (request, reply) => {
    if (guard(request, reply, 'admin')) return;
    const { id } = request.params as { id: string };
    return run(reply, () => dispatcher.retry(id));
  });
}
