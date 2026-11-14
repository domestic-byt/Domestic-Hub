import { createHmac, timingSafeEqual } from 'node:crypto';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

export type ActorRole = 'shipper' | 'operator' | 'admin';

export interface Actor {
  subject: string;
  role: ActorRole;
  name?: string;
}

export interface AuthConfig {
  secret: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    actor?: Actor;
  }
  interface FastifyInstance {
    authSecret?: string;
  }
}

function b64url(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

export function signToken(actor: Actor, secret: string, ttlSeconds = 3600): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(
    JSON.stringify({ sub: actor.subject, role: actor.role, name: actor.name, iat: now, exp: now + ttlSeconds }),
  );
  const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

export function verifyToken(token: string, secret: string): Actor | undefined {
  const parts = token.split('.');
  if (parts.length !== 3) return undefined;
  const [header, payload, signature] = parts as [string, string, string];
  const expected = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  const given = Buffer.from(signature);
  const wanted = Buffer.from(expected);
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) return undefined;

  let claims: { sub?: unknown; role?: unknown; name?: unknown; exp?: unknown };
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
  if (typeof claims.sub !== 'string' || claims.sub === '') return undefined;
  if (typeof claims.exp !== 'number' || claims.exp < Math.floor(Date.now() / 1000)) return undefined;
  if (claims.role !== 'shipper' && claims.role !== 'operator' && claims.role !== 'admin') {
    return undefined;
  }
  return {
    subject: claims.sub,
    role: claims.role,
    name: typeof claims.name === 'string' ? claims.name : undefined,
  };
}

export function authenticate(config: AuthConfig) {
  return async (request: FastifyRequest): Promise<void> => {
    const header = request.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      request.actor = verifyToken(header.slice('Bearer '.length), config.secret);
    }
  };
}

export function guard(
  request: FastifyRequest,
  reply: FastifyReply,
  ...roles: ActorRole[]
): boolean {
  if (!request.server.authSecret) return false;
  const actor = request.actor;
  if (!actor) {
    reply.code(401).send({
      error: 'Authentication required. Send a Bearer token issued by DomesticHub SSO.',
    });
    return true;
  }
  if (!roles.includes(actor.role)) {
    reply.code(403).send({ error: `This action requires role: ${roles.join(' or ')}.` });
    return true;
  }
  return false;
}
