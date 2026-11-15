import { FastifyInstance } from 'fastify';
import { AdvanceAction, AdvanceChannel } from '@afro-link/shared';
import { MarketplaceStore } from '../store';
import { guard } from '../auth';
import { run } from './loads';
import { recordAudit } from '../audit';

const CHANNELS: AdvanceChannel[] = ['telebirr', 'cbe_birr'];
const ACTIONS: AdvanceAction[] = ['approve', 'reject', 'disburse', 'recover', 'default'];

export async function advanceRoutes(app: FastifyInstance, store: MarketplaceStore) {
  app.get('/advances', async () => store.listAdvances());

  app.get('/operators/:id/advances', async (request, reply) => {
    if (guard(request, reply, 'operator', 'admin')) return;
    const { id } = request.params as { id: string };
    const actor = request.actor;
    if (actor?.role === 'operator' && actor.subject !== id) {
      return reply.code(403).send({ error: 'Operators can only view their own advances.' });
    }
    return run(reply, () => store.listAdvancesFor(id));
  });

  app.post('/advances', async (request, reply) => {
    if (guard(request, reply, 'operator', 'admin')) return;
    const body = request.body as {
      operatorId?: string;
      shipmentId?: string;
      amountEtb?: number;
      channel?: string;
    } | null;
    if (!body || !body.operatorId || !body.shipmentId || typeof body.amountEtb !== 'number') {
      return reply.code(400).send({
        error: 'operatorId, shipmentId and amountEtb are required.',
      });
    }
    if (!CHANNELS.includes(body.channel as AdvanceChannel)) {
      return reply.code(400).send({ error: `channel must be one of: ${CHANNELS.join(', ')}.` });
    }
    return run(
      reply,
      () =>
        store.requestFuelAdvance({
          operatorId: body.operatorId!,
          shipmentId: body.shipmentId!,
          amountEtb: body.amountEtb!,
          channel: body.channel as AdvanceChannel,
        }),
      201,
    );
  });

  app.post('/advances/:id/transition', async (request, reply) => {
    if (guard(request, reply, 'admin')) return;
    const { id } = request.params as { id: string };
    const body = request.body as { action?: string } | null;
    if (!ACTIONS.includes(body?.action as AdvanceAction)) {
      return reply.code(400).send({ error: `action must be one of: ${ACTIONS.join(', ')}.` });
    }
    return run(reply, () => store.transitionAdvance(id, body!.action as AdvanceAction));
  });

  app.post('/advances/:id/retry-payout', async (request, reply) => {
    if (guard(request, reply, 'admin')) return;
    const { id } = request.params as { id: string };
    await recordAudit(store, request, 'advance.retry_payout', id);
    return run(reply, () => store.retryPayout(id));
  });
}
