import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Knex } from 'knex';

/**
 * Middleware : 403 si l'utilisateur n'est pas super_admin.
 * À utiliser comme preHandler sur toutes les routes /super-admin/*.
 */
export function requireSuperAdmin(fastify: FastifyInstance) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await fastify
      .db('user')
      .where({ id: request.user.sub })
      .select('is_super_admin')
      .first();
    if (!user?.is_super_admin) {
      return reply.code(403).send({
        statusCode: 403,
        error: 'Forbidden',
        message: 'Super admin only',
      });
    }
  };
}

interface AuditLogParams {
  super_admin_id: string;
  action: string;
  target_type?: string;
  target_id?: string;
  metadata?: Record<string, unknown>;
  ip?: string;
}

/** Insère une ligne dans audit_log. Fire-and-forget — on ne bloque pas la requête. */
export async function logAudit(db: Knex, params: AuditLogParams): Promise<void> {
  await db('audit_log').insert({
    super_admin_id: params.super_admin_id,
    action: params.action,
    target_type: params.target_type ?? null,
    target_id: params.target_id ?? null,
    metadata: params.metadata ? JSON.stringify(params.metadata) : null,
    ip: params.ip ?? null,
  });
}
