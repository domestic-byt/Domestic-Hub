import { FastifyInstance } from 'fastify';
import {
  AdvanceAction,
  AdvanceChannel,
  FuelAdvance,
  nextAdvanceStatus,
  validateAdvanceRequest,
} from '@afro-link/shared';
import { Repo } from '../repo';

const CHANNELS: AdvanceChannel[] = ['telebirr', 'cbe_birr'];
const ACTIONS: AdvanceAction[] = ['approve', 'reject', 'disburse', 'recover', 'default'];

export async function advanceRoutes(app: FastifyInstance, repo: Repo) {
  app.get('/advances', async () => [...repo.advances.values()]);

  app.post('/advances', async (request, reply) => {
    const body = request.body as {
      operatorId?: string;
      shipmentId?: string;
      amountEtb?: number;
      channel?: string;
    } | null;
    if (!body?.operatorId || !body?.shipmentId || typeof body.amountEtb !== 'number') {
      return reply.code(400).send({
        error: 'operatorId, shipmentId and amountEtb are required.',
      });
    }
    if (!CHANNELS.includes(body.channel as AdvanceChannel)) {
      return reply.code(400).send({ error: `channel must be one of: ${CHANNELS.join(', ')}.` });
    }
    const shipment = repo.shipments.get(body.shipmentId);
    if (!shipment) {
      return reply.code(404).send({ error: 'Shipment not found.' });
    }
    if (shipment.operatorId !== body.operatorId) {
      return reply.code(409).send({ error: 'Shipment does not belong to this operator.' });
    }
    const load = repo.loads.get(shipment.loadId);
    if (!load) {
      return reply.code(404).send({ error: 'Load not found.' });
    }
    const errors = validateAdvanceRequest({
      amountEtb: body.amountEtb,
      load,
      activeAdvances: repo.activeAdvancesFor(body.operatorId),
    });
    if (errors.length > 0) {
      return reply.code(422).send({ errors });
    }

    const advance: FuelAdvance = {
      id: crypto.randomUUID(),
      operatorId: body.operatorId,
      shipmentId: body.shipmentId,
      amountEtb: body.amountEtb,
      channel: body.channel as AdvanceChannel,
      status: 'requested',
      requestedAt: new Date().toISOString(),
    };
    repo.advances.set(advance.id, advance);
    return reply.code(201).send(advance);
  });

  app.post('/advances/:id/transition', async (request, reply) => {
    const { id } = request.params as { id: string };
    const advance = repo.advances.get(id);
    if (!advance) {
      return reply.code(404).send({ error: 'Advance not found.' });
    }
    const body = request.body as { action?: string } | null;
    if (!ACTIONS.includes(body?.action as AdvanceAction)) {
      return reply.code(400).send({ error: `action must be one of: ${ACTIONS.join(', ')}.` });
    }
    const next = nextAdvanceStatus(advance.status, body!.action as AdvanceAction);
    if (!next) {
      return reply.code(409).send({
        error: `Cannot ${body!.action} an advance in status '${advance.status}'.`,
      });
    }
    const updated = { ...advance, status: next };
    repo.advances.set(id, updated);
    return updated;
  });
}
