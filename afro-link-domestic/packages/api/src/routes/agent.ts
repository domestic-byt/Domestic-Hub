import { FastifyInstance } from 'fastify';
import { DomesticAgent } from '@afro-link/agent';
import { guard } from '../auth';

export async function agentRoutes(app: FastifyInstance, agent: DomesticAgent) {
  app.post('/agent/chat', async (request, reply) => {
    if (guard(request, reply, 'shipper', 'operator', 'admin')) return;
    const body = request.body as {
      message?: string;
      sessionId?: string;
      shipperId?: string;
      operatorId?: string;
      shipperTin?: string;
      operatorTin?: string;
    } | null;
    if (!body || typeof body.message !== 'string' || body.message.trim() === '') {
      return reply.code(400).send({ error: 'message is required.' });
    }
    const actor = request.actor;
    return agent.handle(body.message, {
      sessionKey: body.sessionId ?? actor?.subject,
      shipperId: actor?.role === 'shipper' ? actor.subject : body.shipperId,
      operatorId: actor?.role === 'operator' ? actor.subject : body.operatorId,
      shipperTin: body.shipperTin,
      operatorTin: body.operatorTin,
    });
  });
}
