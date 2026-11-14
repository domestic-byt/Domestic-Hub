import { FastifyInstance } from 'fastify';
import { DomesticAgent } from '@afro-link/agent';

export async function agentRoutes(app: FastifyInstance, agent: DomesticAgent) {
  app.post('/agent/chat', async (request, reply) => {
    const body = request.body as {
      message?: string;
      shipperId?: string;
      operatorId?: string;
      shipperTin?: string;
      operatorTin?: string;
    } | null;
    if (!body || typeof body.message !== 'string' || body.message.trim() === '') {
      return reply.code(400).send({ error: 'message is required.' });
    }
    return agent.handle(body.message, {
      shipperId: body.shipperId,
      operatorId: body.operatorId,
      shipperTin: body.shipperTin,
      operatorTin: body.operatorTin,
    });
  });
}
