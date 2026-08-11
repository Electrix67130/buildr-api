import fp from 'fastify-plugin';
import bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { requireSuperAdmin, logAudit } from '@/lib/super-admin';
import {
  paginationSchema,
  uuidParamSchema,
  chantierFiltersSchema,
} from './super-admin.schema';

const SALT_ROUNDS = 10;

export default fp(
  (fastify, _opts, done) => {
    const guard = [fastify.authenticate, requireSuperAdmin(fastify)];

    // ---------- Overview ----------
    fastify.get('/super-admin/overview', { preHandler: guard }, async () => {
      const [
        [{ orgs_total }],
        [{ orgs_active }],
        [{ users_total }],
        [{ users_active }],
        [{ chantiers_active }],
        [{ chantiers_archived }],
        recentOrgs,
        recentUsers,
      ] = await Promise.all([
        fastify.db('organization').count('* as orgs_total') as unknown as Promise<{ orgs_total: string }[]>,
        fastify.db('organization').where('is_active', true).count('* as orgs_active') as unknown as Promise<{ orgs_active: string }[]>,
        fastify.db('user').count('* as users_total') as unknown as Promise<{ users_total: string }[]>,
        fastify.db('user').where('is_active', true).count('* as users_active') as unknown as Promise<{ users_active: string }[]>,
        fastify.db('chantier').whereNull('archived_at').count('* as chantiers_active') as unknown as Promise<{ chantiers_active: string }[]>,
        fastify.db('chantier').whereNotNull('archived_at').count('* as chantiers_archived') as unknown as Promise<{ chantiers_archived: string }[]>,
        fastify.db('organization').select('id', 'name', 'created_at').orderBy('created_at', 'desc').limit(5),
        fastify
          .db('user')
          .select('id', 'email', 'first_name', 'last_name', 'created_at')
          .orderBy('created_at', 'desc')
          .limit(5),
      ]);

      // Sièges facturables = membres avec rôle admin/manager/employee
      const billableRows = (await fastify
        .db('organization_member')
        .whereIn('role', ['admin', 'manager', 'employee'])
        .count('* as count')) as { count: string }[];
      const billable_seats = parseInt(billableRows[0].count, 10);

      return {
        orgs: { total: parseInt(orgs_total, 10), active: parseInt(orgs_active, 10) },
        users: { total: parseInt(users_total, 10), active: parseInt(users_active, 10) },
        chantiers: {
          active: parseInt(chantiers_active, 10),
          archived: parseInt(chantiers_archived, 10),
        },
        billing: { billable_seats, estimated_monthly_eur: billable_seats * 10 },
        recent_orgs: recentOrgs,
        recent_users: recentUsers,
      };
    });

    // ---------- Organizations ----------
    fastify.get('/super-admin/orgs', { preHandler: guard }, async (request) => {
      const { page, limit, q } = paginationSchema.parse(request.query);
      const offset = (page - 1) * limit;

      const baseQuery = fastify.db('organization');
      if (q) baseQuery.whereILike('name', `%${q}%`);

      const [{ count }] = (await baseQuery.clone().count('* as count')) as { count: string }[];
      const rows = await baseQuery
        .clone()
        .leftJoin('organization_member', 'organization_member.organization_id', 'organization.id')
        .leftJoin('chantier', function () {
          this.on('chantier.organization_id', '=', 'organization.id').andOnNull('chantier.archived_at');
        })
        .select(
          'organization.id',
          'organization.name',
          'organization.is_active',
          'organization.archive_retention_years',
          'organization.created_at',
        )
        .countDistinct('organization_member.user_id as member_count')
        .countDistinct('chantier.id as chantier_count')
        .groupBy('organization.id')
        .orderBy('organization.created_at', 'desc')
        .limit(limit)
        .offset(offset);

      return {
        data: rows.map((r) => ({
          ...r,
          member_count: parseInt(String(r.member_count), 10),
          chantier_count: parseInt(String(r.chantier_count), 10),
        })),
        meta: {
          total: parseInt(count, 10),
          page,
          limit,
          totalPages: Math.ceil(parseInt(count, 10) / limit),
        },
      };
    });

    fastify.get('/super-admin/orgs/:id', { preHandler: guard }, async (request, reply) => {
      const { id } = uuidParamSchema.parse(request.params);
      const org = await fastify.db('organization').where({ id }).first();
      if (!org) return reply.notFound('Organization not found');

      const [members, chantiers] = await Promise.all([
        fastify
          .db('organization_member')
          .join('user', 'user.id', 'organization_member.user_id')
          .where('organization_member.organization_id', id)
          .select(
            'user.id',
            'user.email',
            'user.first_name',
            'user.last_name',
            'user.is_active',
            'organization_member.role',
            'organization_member.created_at as joined_at',
          )
          .orderBy('organization_member.created_at', 'asc'),
        fastify
          .db('chantier')
          .where({ organization_id: id })
          .select('id', 'name', 'status', 'archived_at', 'created_at')
          .orderBy('created_at', 'desc')
          .limit(50),
      ]);

      return { ...org, members, chantiers };
    });

    fastify.post('/super-admin/orgs/:id/disable', { preHandler: guard }, async (request, reply) => {
      const { id } = uuidParamSchema.parse(request.params);
      const updated = await fastify.db('organization').where({ id }).update({ is_active: false });
      if (!updated) return reply.notFound('Organization not found');
      await logAudit(fastify.db, {
        super_admin_id: request.user.sub,
        action: 'org.disable',
        target_type: 'organization',
        target_id: id,
        ip: request.ip,
      });
      return { ok: true };
    });

    fastify.post('/super-admin/orgs/:id/enable', { preHandler: guard }, async (request, reply) => {
      const { id } = uuidParamSchema.parse(request.params);
      const updated = await fastify.db('organization').where({ id }).update({ is_active: true });
      if (!updated) return reply.notFound('Organization not found');
      await logAudit(fastify.db, {
        super_admin_id: request.user.sub,
        action: 'org.enable',
        target_type: 'organization',
        target_id: id,
        ip: request.ip,
      });
      return { ok: true };
    });

    // Impersonate : trouve un admin de cette org et signe un JWT en son nom.
    // L'action est loggée dans audit_log.
    fastify.post('/super-admin/orgs/:id/impersonate', { preHandler: guard }, async (request, reply) => {
      const { id } = uuidParamSchema.parse(request.params);
      const adminMembership = await fastify
        .db('organization_member')
        .where({ organization_id: id, role: 'admin' })
        .first();
      if (!adminMembership) return reply.notFound('No admin in this organization');

      const targetUser = await fastify
        .db('user')
        .where({ id: adminMembership.user_id })
        .select('id', 'email')
        .first();
      if (!targetUser) return reply.notFound('No admin in this organization');

      const accessToken = await fastify.jwt.sign(
        { sub: targetUser.id, email: targetUser.email, impersonated_by: request.user.sub },
        { expiresIn: '30m' },
      );

      await logAudit(fastify.db, {
        super_admin_id: request.user.sub,
        action: 'org.impersonate',
        target_type: 'organization',
        target_id: id,
        metadata: { as_user_id: adminMembership.user_id },
        ip: request.ip,
      });

      return { access_token: accessToken, user_id: adminMembership.user_id };
    });

    // ---------- Users ----------
    fastify.get('/super-admin/users', { preHandler: guard }, async (request) => {
      const { page, limit, q } = paginationSchema.parse(request.query);
      const offset = (page - 1) * limit;

      const baseQuery = fastify.db('user');
      if (q) {
        baseQuery.where(function () {
          this.whereILike('email', `%${q}%`)
            .orWhereILike('first_name', `%${q}%`)
            .orWhereILike('last_name', `%${q}%`);
        });
      }

      const [{ count }] = (await baseQuery.clone().count('* as count')) as { count: string }[];
      const rows = await baseQuery
        .clone()
        .select(
          'id',
          'email',
          'first_name',
          'last_name',
          'phone',
          'is_active',
          'is_super_admin',
          'created_at',
        )
        .orderBy('created_at', 'desc')
        .limit(limit)
        .offset(offset);

      return {
        data: rows,
        meta: {
          total: parseInt(count, 10),
          page,
          limit,
          totalPages: Math.ceil(parseInt(count, 10) / limit),
        },
      };
    });

    fastify.get('/super-admin/users/:id', { preHandler: guard }, async (request, reply) => {
      const { id } = uuidParamSchema.parse(request.params);
      const user = await fastify.db('user').where({ id }).first();
      if (!user) return reply.notFound('User not found');
      const { password_hash: _ph, ...safe } = user;

      const memberships = await fastify
        .db('organization_member')
        .join('organization', 'organization.id', 'organization_member.organization_id')
        .where('organization_member.user_id', id)
        .select(
          'organization.id as organization_id',
          'organization.name as organization_name',
          'organization.is_active',
          'organization_member.role',
        );

      const [{ session_count }] = (await fastify
        .db('refresh_token')
        .where({ user_id: id })
        .count('* as session_count')) as { session_count: string }[];

      return { ...safe, memberships, active_sessions: parseInt(session_count, 10) };
    });

    fastify.post('/super-admin/users/:id/disable', { preHandler: guard }, async (request, reply) => {
      const { id } = uuidParamSchema.parse(request.params);
      const updated = await fastify.db('user').where({ id }).update({ is_active: false });
      if (!updated) return reply.notFound('User not found');
      await fastify.db('refresh_token').where({ user_id: id }).del(); // kick all sessions
      await logAudit(fastify.db, {
        super_admin_id: request.user.sub,
        action: 'user.disable',
        target_type: 'user',
        target_id: id,
        ip: request.ip,
      });
      return { ok: true };
    });

    fastify.post('/super-admin/users/:id/enable', { preHandler: guard }, async (request, reply) => {
      const { id } = uuidParamSchema.parse(request.params);
      const updated = await fastify.db('user').where({ id }).update({ is_active: true });
      if (!updated) return reply.notFound('User not found');
      await logAudit(fastify.db, {
        super_admin_id: request.user.sub,
        action: 'user.enable',
        target_type: 'user',
        target_id: id,
        ip: request.ip,
      });
      return { ok: true };
    });

    fastify.post('/super-admin/users/:id/kick-sessions', { preHandler: guard }, async (request, reply) => {
      const { id } = uuidParamSchema.parse(request.params);
      const deleted = await fastify.db('refresh_token').where({ user_id: id }).del();
      await logAudit(fastify.db, {
        super_admin_id: request.user.sub,
        action: 'user.kick_sessions',
        target_type: 'user',
        target_id: id,
        metadata: { sessions_killed: deleted },
        ip: request.ip,
      });
      return { ok: true, sessions_killed: deleted };
    });

    // Force reset password : génère un mot de passe temporaire, met à jour le hash,
    // kick toutes les sessions. Le super_admin reçoit le mot de passe à transmettre.
    fastify.post('/super-admin/users/:id/force-reset', { preHandler: guard }, async (request, reply) => {
      const { id } = uuidParamSchema.parse(request.params);
      const user = await fastify.db('user').where({ id }).first();
      if (!user) return reply.notFound('User not found');

      const tempPassword = `Tmp-${randomUUID().slice(0, 12)}`;
      const hash = await bcrypt.hash(tempPassword, SALT_ROUNDS);
      await fastify.db('user').where({ id }).update({ password_hash: hash });
      await fastify.db('refresh_token').where({ user_id: id }).del();

      await logAudit(fastify.db, {
        super_admin_id: request.user.sub,
        action: 'user.force_reset',
        target_type: 'user',
        target_id: id,
        ip: request.ip,
      });

      return { ok: true, temporary_password: tempPassword };
    });

    fastify.delete('/super-admin/users/:id', { preHandler: guard }, async (request, reply) => {
      const { id } = uuidParamSchema.parse(request.params);
      if (id === request.user.sub) {
        return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'Cannot delete yourself' });
      }
      const deleted = await fastify.db('user').where({ id }).del();
      if (!deleted) return reply.notFound('User not found');
      await logAudit(fastify.db, {
        super_admin_id: request.user.sub,
        action: 'user.delete',
        target_type: 'user',
        target_id: id,
        ip: request.ip,
      });
      return reply.code(204).send();
    });

    // ---------- Chantiers ----------
    fastify.get('/super-admin/chantiers', { preHandler: guard }, async (request) => {
      const { page, limit, q, organization_id, user_id, status, archived, sort, order } =
        chantierFiltersSchema.parse(request.query);
      const offset = (page - 1) * limit;

      const baseQuery = fastify.db('chantier');

      if (q) {
        baseQuery.where(function () {
          this.whereILike('chantier.name', `%${q}%`)
            .orWhereILike('chantier.address', `%${q}%`)
            .orWhereILike('chantier.city', `%${q}%`);
        });
      }
      if (organization_id) baseQuery.where('chantier.organization_id', organization_id);
      if (status) baseQuery.where('chantier.status', status);
      if (archived === 'true') baseQuery.whereNotNull('chantier.archived_at');
      else if (archived === 'false') baseQuery.whereNull('chantier.archived_at');

      if (user_id) {
        baseQuery.whereIn('chantier.id', function () {
          this.select('chantier_id').from('chantier_member').where('user_id', user_id);
        });
      }

      const [{ count }] = (await baseQuery.clone().count('* as count')) as { count: string }[];

      const sortColumn = `chantier.${sort}`;
      const rows = await baseQuery
        .clone()
        .leftJoin('organization', 'organization.id', 'chantier.organization_id')
        .leftJoin('user as creator', 'creator.id', 'chantier.created_by')
        .leftJoin('chantier_member', 'chantier_member.chantier_id', 'chantier.id')
        .select(
          'chantier.id',
          'chantier.name',
          'chantier.address',
          'chantier.city',
          'chantier.status',
          'chantier.archived_at',
          'chantier.created_at',
          'chantier.organization_id',
          'organization.name as organization_name',
          'organization.is_active as organization_active',
          'creator.id as created_by_id',
          'creator.email as created_by_email',
          'creator.first_name as created_by_first_name',
          'creator.last_name as created_by_last_name',
        )
        .countDistinct('chantier_member.user_id as member_count')
        .groupBy('chantier.id', 'organization.id', 'creator.id')
        .orderBy(sortColumn, order)
        .limit(limit)
        .offset(offset);

      return {
        data: rows.map((r) => ({
          ...r,
          member_count: parseInt(String(r.member_count), 10),
        })),
        meta: {
          total: parseInt(count, 10),
          page,
          limit,
          totalPages: Math.ceil(parseInt(count, 10) / limit),
        },
      };
    });

    fastify.get('/super-admin/chantiers/:id', { preHandler: guard }, async (request, reply) => {
      const { id } = uuidParamSchema.parse(request.params);
      const chantier = await fastify
        .db('chantier')
        .leftJoin('organization', 'organization.id', 'chantier.organization_id')
        .leftJoin('user as creator', 'creator.id', 'chantier.created_by')
        .where('chantier.id', id)
        .select(
          'chantier.*',
          'organization.name as organization_name',
          'organization.is_active as organization_active',
          'creator.email as created_by_email',
          'creator.first_name as created_by_first_name',
          'creator.last_name as created_by_last_name',
        )
        .first();
      if (!chantier) return reply.notFound('Chantier not found');

      const [members, [{ photo_count }], [{ document_count }], [{ step_count }]] = await Promise.all([
        fastify
          .db('chantier_member')
          .join('user', 'user.id', 'chantier_member.user_id')
          .where('chantier_member.chantier_id', id)
          .select(
            'user.id',
            'user.email',
            'user.first_name',
            'user.last_name',
            'user.is_active',
            'chantier_member.role',
            'chantier_member.created_at as joined_at',
          )
          .orderBy('chantier_member.created_at', 'asc'),
        fastify.db('photo').where({ chantier_id: id }).count('* as photo_count') as unknown as Promise<{ photo_count: string }[]>,
        fastify.db('document').where({ chantier_id: id }).count('* as document_count') as unknown as Promise<{ document_count: string }[]>,
        fastify.db('chantier_step').where({ chantier_id: id }).count('* as step_count') as unknown as Promise<{ step_count: string }[]>,
      ]);

      return {
        ...chantier,
        members,
        counts: {
          photos: parseInt(photo_count, 10),
          documents: parseInt(document_count, 10),
          steps: parseInt(step_count, 10),
          members: members.length,
        },
      };
    });

    // ---------- Audit log ----------
    fastify.get('/super-admin/audit', { preHandler: guard }, async (request) => {
      const { page, limit } = paginationSchema.parse(request.query);
      const offset = (page - 1) * limit;

      const [{ count }] = (await fastify.db('audit_log').count('* as count')) as { count: string }[];
      const rows = await fastify
        .db('audit_log')
        .leftJoin('user', 'user.id', 'audit_log.super_admin_id')
        .select(
          'audit_log.*',
          'user.email as super_admin_email',
          'user.first_name as super_admin_first_name',
          'user.last_name as super_admin_last_name',
        )
        .orderBy('audit_log.created_at', 'desc')
        .limit(limit)
        .offset(offset);

      return {
        data: rows,
        meta: { total: parseInt(count, 10), page, limit, totalPages: Math.ceil(parseInt(count, 10) / limit) },
      };
    });

    // ---------- Error log ----------
    fastify.get('/super-admin/errors', { preHandler: guard }, async (request) => {
      const { page, limit } = paginationSchema.parse(request.query);
      const offset = (page - 1) * limit;

      const [{ count }] = (await fastify.db('error_log').count('* as count')) as { count: string }[];
      const rows = await fastify
        .db('error_log')
        .leftJoin('user', 'user.id', 'error_log.user_id')
        .select('error_log.*', 'user.email as user_email')
        .orderBy('error_log.created_at', 'desc')
        .limit(limit)
        .offset(offset);

      return {
        data: rows,
        meta: { total: parseInt(count, 10), page, limit, totalPages: Math.ceil(parseInt(count, 10) / limit) },
      };
    });

    done();
  },
  { name: 'super-admin-module' },
);
