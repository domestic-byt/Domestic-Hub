import { FastifyInstance } from 'fastify';
import { VatInvoice, computeVat } from '@afro-link/shared';
import { Repo } from '../repo';

export async function invoiceRoutes(app: FastifyInstance, repo: Repo) {
  app.get('/invoices', async () => [...repo.invoices.values()]);

  app.post('/invoices', async (request, reply) => {
    const body = request.body as {
      shipmentId?: string;
      shipperTin?: string;
      operatorTin?: string;
    } | null;
    if (!body?.shipmentId || !body?.shipperTin || !body?.operatorTin) {
      return reply.code(400).send({
        error: 'shipmentId, shipperTin and operatorTin are required.',
      });
    }
    const shipment = repo.shipments.get(body.shipmentId);
    if (!shipment) {
      return reply.code(404).send({ error: 'Shipment not found.' });
    }
    if (shipment.status !== 'delivered') {
      return reply.code(409).send({ error: 'Invoices can only be issued for delivered shipments.' });
    }
    const load = repo.loads.get(shipment.loadId);
    if (!load) {
      return reply.code(404).send({ error: 'Load not found.' });
    }
    const vat = computeVat(load.offeredPriceEtb);
    const invoice: VatInvoice = {
      id: crypto.randomUUID(),
      shipmentId: shipment.id,
      shipperTin: body.shipperTin,
      operatorTin: body.operatorTin,
      subtotalEtb: vat.subtotalEtb,
      vatEtb: vat.vatEtb,
      totalEtb: vat.totalEtb,
      issuedAt: new Date().toISOString(),
    };
    repo.invoices.set(invoice.id, invoice);
    return reply.code(201).send(invoice);
  });

  app.get('/invoices/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const invoice = repo.invoices.get(id);
    if (!invoice) {
      return reply.code(404).send({ error: 'Invoice not found.' });
    }
    return invoice;
  });
}
