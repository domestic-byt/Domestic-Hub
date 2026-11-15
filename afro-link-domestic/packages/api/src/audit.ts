import { FastifyRequest } from 'fastify';
import { AuditEntry } from '@afro-link/shared';
import type { MarketplaceRepo } from './repo';

export function auditFromRequest(
  request: FastifyRequest,
  action: string,
  target: string,
  detail?: string,
): AuditEntry {
  const actor = request.actor;
  return {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    actorId: actor?.subject ?? 'anonymous',
    actorRole: actor?.role ?? 'anonymous',
    action,
    target,
    detail,
  };
}

export async function recordAudit(
  repo: Pick<MarketplaceRepo, 'saveAuditEntry'>,
  request: FastifyRequest,
  action: string,
  target: string,
  detail?: string,
): Promise<void> {
  await repo.saveAuditEntry(auditFromRequest(request, action, target, detail));
}
