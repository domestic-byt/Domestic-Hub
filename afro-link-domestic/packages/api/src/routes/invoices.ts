import { FastifyInstance } from 'fastify';
import { MarketplaceStore } from '../store';
import { guard } from '../auth';
import { run } from './loads';

export async function invoiceRoutes(app: FastifyInstance, store: MarketplaceStore) {
  app.get('/invoices', async () => store.listInvoices());

  app.post('/invoices', async (request, reply) => {
    if (guard(request, reply, 'shipper', 'admin')) return;
    const body = request.body as {
      shipmentId?: string;
      shipperTin?: string;
      operatorTin?: string;
    } | null;
    if (!body || !body.shipmentId || !body.shipperTin || !body.operatorTin) {
      return reply.code(400).send({
        error: 'shipmentId, shipperTin and operatorTin are required.',
      });
    }
    return run(
      reply,
      () =>
        store.createInvoice({
          shipmentId: body.shipmentId!,
          shipperTin: body.shipperTin!,
          operatorTin: body.operatorTin!,
        }),
      201,
    );
  });

  app.get('/invoices/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    return run(reply, () => store.getInvoice(id));
  });

  app.get('/shippers/:id/invoices', async (request, reply) => {
    if (guard(request, reply, 'shipper', 'admin')) return;
    const { id } = request.params as { id: string };
    const actor = request.actor;
    if (actor?.role === 'shipper' && actor.subject !== id) {
      return reply.code(403).send({ error: 'Shippers can only view their own invoices.' });
    }
    return run(reply, () => store.listInvoicesFor(id));
  });
}
