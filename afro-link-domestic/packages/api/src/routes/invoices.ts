import { FastifyInstance } from 'fastify';
import { MarketplaceStore } from '../store';
import { run } from './loads';

export async function invoiceRoutes(app: FastifyInstance, store: MarketplaceStore) {
  app.get('/invoices', async () => store.listInvoices());

  app.post('/invoices', async (request, reply) => {
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
}
