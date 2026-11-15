import { FastifyInstance } from 'fastify';
import { KycDecision } from '@afro-link/shared';
import { MarketplaceStore } from '../store';
import { guard } from '../auth';
import { run } from './loads';
import { recordAudit } from '../audit';

const KYC_DECISIONS: KycDecision[] = ['pending', 'approved', 'rejected'];

interface KycReviewBody {
  decision?: unknown;
  licenseExpiry?: unknown;
  insuranceExpiry?: unknown;
}

export async function adminRoutes(app: FastifyInstance, store: MarketplaceStore) {
  app.get('/admin/kyc', async (request, reply) => {
    if (guard(request, reply, 'admin')) return;
    return run(reply, () => store.kycReviewQueue());
  });

  app.post('/operators/:id/kyc', async (request, reply) => {
    if (guard(request, reply, 'admin')) return;
    const { id } = request.params as { id: string };
    const body = request.body as KycReviewBody | null;
    if (
      typeof body?.decision !== 'string' ||
      !KYC_DECISIONS.includes(body.decision as KycDecision)
    ) {
      return reply
        .code(422)
        .send({ errors: ['decision must be one of pending, approved, rejected.'] });
    }
    const dateFields: Array<['licenseExpiry' | 'insuranceExpiry', unknown]> = [
      ['licenseExpiry', body.licenseExpiry],
      ['insuranceExpiry', body.insuranceExpiry],
    ];
    const errors = dateFields
      .filter(([, value]) => value !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(value)))
      .map(([field]) => `${field} must be an ISO date (YYYY-MM-DD).`);
    if (errors.length > 0) {
      return reply.code(422).send({ errors });
    }
    await recordAudit(store, request, 'kyc.review', id, String(body.decision));
    return run(
      reply,
      () =>
        store.reviewKyc({
          operatorId: id,
          decision: body!.decision as KycDecision,
          licenseExpiry: body.licenseExpiry === undefined ? undefined : String(body.licenseExpiry),
          insuranceExpiry:
            body.insuranceExpiry === undefined ? undefined : String(body.insuranceExpiry),
        }),
      200,
    );
  });

  app.get('/admin/fleet', async (request, reply) => {
    if (guard(request, reply, 'admin')) return;
    return run(reply, () => store.fleetOverview());
  });

  app.get('/admin/audit', async (request, reply) => {
    if (guard(request, reply, 'admin')) return;
    return run(reply, () => store.listAuditEntries());
  });
}
