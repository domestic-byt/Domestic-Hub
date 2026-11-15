import { FastifyInstance } from 'fastify';
import { VatInvoice } from '@afro-link/shared';
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

  app.get('/invoices/:id/view', async (request, reply) => {
    const { id } = request.params as { id: string };
    return run(reply, async () => {
      const invoice = await store.getInvoice(id);
      reply.type('text/html; charset=utf-8');
      return invoiceHtml(invoice);
    });
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

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

export function invoiceHtml(invoice: VatInvoice): string {
  const esc = escapeHtml;
  const issued = new Date(invoice.issuedAt).toLocaleString('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Africa/Addis_Ababa',
  });
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>VAT Invoice ${esc(invoice.id)}</title>
<style>
  body { font-family: Georgia, 'Times New Roman', serif; margin: 2rem auto; max-width: 42rem; color: #1a1a1a; }
  header { border-bottom: 3px solid #1a1a1a; padding-bottom: 0.75rem; margin-bottom: 1.5rem; }
  h1 { margin: 0; font-size: 1.4rem; letter-spacing: 0.05em; }
  .muted { color: #555; }
  table { width: 100%; border-collapse: collapse; margin-top: 1.5rem; }
  td, th { padding: 0.5rem 0.75rem; border-bottom: 1px solid #ddd; text-align: left; }
  .amount { text-align: right; font-variant-numeric: tabular-nums; }
  .total td { font-weight: bold; border-top: 2px solid #1a1a1a; border-bottom: none; font-size: 1.05rem; }
  .parties { display: flex; gap: 2rem; flex-wrap: wrap; }
  footer { margin-top: 2rem; font-size: 0.85rem; color: #555; border-top: 1px solid #ddd; padding-top: 0.75rem; }
  @media print { body { margin: 0; } }
</style>
</head>
<body>
<header>
  <h1>Afro-Link Domestic</h1>
  <div class="muted">VAT Invoice &middot; part of DomesticHub</div>
</header>
<div class="parties">
  <div>
    <strong>Bill to (shipper)</strong><br />
    TIN: ${esc(invoice.shipperTin)}
  </div>
  <div>
    <strong>Carrier (operator)</strong><br />
    TIN: ${esc(invoice.operatorTin)}
  </div>
  <div>
    <strong>Invoice</strong><br />
    ${esc(invoice.id)}<br />
    <span class="muted">Issued ${esc(issued)}</span>
  </div>
</div>
<p class="muted">Shipment: ${esc(invoice.shipmentId)}</p>
<table>
  <tr><th>Description</th><th class="amount">Amount (ETB)</th></tr>
  <tr><td>Freight service (15% Ethiopian VAT applicable)</td><td class="amount">${invoice.subtotalEtb.toLocaleString('en-US')}</td></tr>
  <tr><td>VAT (15%)</td><td class="amount">${invoice.vatEtb.toLocaleString('en-US')}</td></tr>
  <tr class="total"><td>Total due</td><td class="amount">${invoice.totalEtb.toLocaleString('en-US')} ETB</td></tr>
</table>
<footer>
  Afro-Link Domestic &middot; afro-link.domestic.com.et &mdash; compliant VAT invoice issued through DomesticHub.
</footer>
</body>
</html>`;
}
