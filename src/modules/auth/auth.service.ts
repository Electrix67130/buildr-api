import { FastifyInstance } from 'fastify';
import bcrypt from 'bcrypt';
import { randomUUID, createHmac } from 'crypto';
import UserService from '@/modules/user/user.service';
import InvitationService from '@/modules/invitation/invitation.service';
import { RegisterInput } from './auth.schema';
import { UserRow, toPublicUser } from '@/modules/user/user.schema';
import env from '@/config/env';
import { invalidateSessionCache, type Platform } from '@/lib/session-cache';
import { closeUserConnections } from '@/lib/realtime-hub';
import { normalizePhone } from '@/lib/phone';

const SALT_ROUNDS = 12;

/**
 * Tolerance de reutilisation d'un jeton de rafraichissement deja remplace.
 *
 * La rotation supprime l'ancien jeton a chaque echange. Si la reponse se
 * perd — reseau coupe sur un chantier, app tuee par le systeme au mauvais
 * moment — le telephone garde un jeton mort et se retrouve deconnecte au
 * renouvellement suivant. Pendant cette fenetre, rejouer l'ancien jeton
 * redonne la session en cours au lieu de la refuser. Il n'en cree pas une
 * seconde : c'est le meme identifiant de session, et le meme jeton vivant.
 */
const REFRESH_REUSE_GRACE_MS = 60_000;

/**
 * Un jeton de rafraichissement inutilise pendant cette duree est refuse. La
 * rotation en emet un nouveau a chaque usage, donc « inutilise » se lit sur
 * la date de creation : un appareil actif ne l'atteint jamais, un telephone
 * perdu ne reste pas connecte a vie.
 */
const REFRESH_MAX_IDLE_DAYS = 90;

type RefreshTokenRow = {
  id: string;
  user_id: string;
  token: string;
  platform: Platform | null;
  created_at: string;
  replaced_at: string | null;
  replaced_by: string | null;
};

class AuthService {
  private fastify: FastifyInstance;
  private userService: UserService;
  private invitationService: InvitationService;

  constructor(fastify: FastifyInstance) {
    this.fastify = fastify;
    this.userService = new UserService(fastify.db);
    this.invitationService = new InvitationService(fastify.db);
  }

  async register(data: RegisterInput) {
    let finalEmail = data.email;
    let finalRole = data.role;
    let finalCompanyName = data.company_name;
    let invitationId: string | null = null;
    let organizationId: string | null = null;
    let invitationLocale: string | null = null;

    // If registering via invitation: use invitation's email, role and organization_id
    if (data.invitation_token) {
      const invitation = await this.fastify.db('invitation')
        .where({ token: data.invitation_token, status: 'pending' })
        .first();
      if (!invitation) {
        throw Object.assign(new Error('Invalid or expired invitation'), { statusCode: 400 });
      }
      if (new Date(invitation.expires_at) < new Date()) {
        throw Object.assign(new Error('Invitation expired'), { statusCode: 400 });
      }
      finalEmail = invitation.email;
      finalRole = invitation.role;
      invitationId = invitation.id;
      organizationId = invitation.organization_id;
      // La langue choisie par l'employeur prime sur celle de l'interface : il a
      // deja tranche pour son collaborateur en l'invitant, et c'est dans cette
      // langue que celui-ci a lu son invitation.
      invitationLocale = invitation.locale;

      // Rule: an invited employee is part of the inviter's company → company_name = org name
      // A client may set their own company (e.g. "EIFFAGE" as client of "Buildr SAS")
      if (finalRole === 'employee' || finalRole === 'admin') {
        const org = await this.fastify.db('organization').where({ id: organizationId }).first();
        finalCompanyName = org?.name ?? finalCompanyName;
      }
      // For 'client', keep data.company_name as provided by the user
    }

    const existing = await this.userService.findByEmail(finalEmail);
    if (existing) {
      throw Object.assign(new Error('Email already in use'), { statusCode: 409 });
    }

    const passwordHash = await bcrypt.hash(data.password, SALT_ROUNDS);

    // If no invitation, create a new organization for this user (they become admin of it)
    if (!organizationId) {
      const orgName = data.company_name || `${data.first_name} ${data.last_name}`;
      const orgPayload: Record<string, unknown> = { name: orgName };
      if (data.organization) {
        for (const [key, value] of Object.entries(data.organization)) {
          if (value === undefined) continue;
          orgPayload[key] = value;
        }
        // L'organisation est inseree en direct, sans passer par son service :
        // on normalise ici, avec le pays que le formulaire vient de donner.
        if (data.organization.phone !== undefined) {
          orgPayload.phone = normalizePhone(data.organization.phone, data.organization.country);
        }
      }
      const [org] = await this.fastify.db('organization')
        .insert(orgPayload)
        .returning('id');
      organizationId = org.id;
      // New standalone accounts are always admins of their own organization
      finalRole = 'admin';
      finalCompanyName = orgName;
    }

    const user = await this.userService.create({
      email: finalEmail,
      password_hash: passwordHash,
      first_name: data.first_name,
      last_name: data.last_name,
      phone: data.phone,
      role: finalRole, // legacy column — sera retire en migration B
      company_name: finalCompanyName,
      organization_id: organizationId, // legacy column — sera retire en migration B
      active_organization_id: organizationId,
      locale: invitationLocale ?? data.locale ?? 'fr',
    } as Partial<UserRow>);

    // Cree la membership dans la nouvelle table organization_member.
    await this.fastify.db('organization_member')
      .insert({ organization_id: organizationId, user_id: user.id, role: finalRole })
      .onConflict(['organization_id', 'user_id'])
      .ignore();

    // Set the organization's created_by to the first admin if not set
    await this.fastify.db('organization')
      .where({ id: organizationId })
      .whereNull('created_by')
      .update({ created_by: user.id });

    // Invitation acceptee, et equipe du manager inviteur : meme chemin qu'a la
    // connexion d'un compte existant (voir InvitationService.redeem).
    if (invitationId) {
      const invitation = await this.invitationService.findById(invitationId);
      if (invitation) await this.invitationService.redeem(invitation, user.id);
    }

    const tokens = await this.generateTokens(user, data.platform ?? 'web');
    const safeUser = toPublicUser(user);

    return { user: safeUser, ...tokens };
  }

  async updatePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.userService.findById(userId);
    if (!user) {
      throw Object.assign(new Error('User not found'), { statusCode: 404 });
    }

    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) {
      throw Object.assign(new Error('Current password is incorrect'), { statusCode: 401 });
    }

    const newHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await this.userService.update(userId, { password_hash: newHash } as Partial<UserRow>);

    // Revoke all refresh tokens to force re-login on other devices
    await this.fastify.db('refresh_token').where({ user_id: userId }).del();

    return { message: 'Password updated successfully' };
  }

  async forgotPassword(email: string) {
    const user = await this.userService.findByEmail(email);
    // Always return success to avoid email enumeration
    if (!user || !user.is_active) {
      return { message: 'If an account exists with this email, a reset link has been sent.' };
    }

    // Generate a reset token: userId + expiry, signed with JWT_SECRET
    const expires = Date.now() + 30 * 60 * 1000; // 30 minutes
    const data = `${user.id}:${expires}`;
    const signature = createHmac('sha256', env.JWT_SECRET).update(data).digest('hex');
    const token = Buffer.from(JSON.stringify({ u: user.id, e: expires, s: signature })).toString('base64url');

    const { sendMail, buildPasswordResetEmail } = await import('@/lib/mailer');
    // La langue vient de l'utilisateur : personne ne peut la choisir ici, c'est
    // lui qui declenche la demande et il n'est pas connecte.
    const { subject, html } = buildPasswordResetEmail({ token, locale: user.locale });

    await sendMail({ to: email, subject, html });

    return { message: 'If an account exists with this email, a reset link has been sent.' };
  }

  async resetPassword(token: string, newPassword: string) {
    let decoded: { u: string; e: number; s: string };
    try {
      decoded = JSON.parse(Buffer.from(token, 'base64url').toString());
    } catch {
      throw Object.assign(new Error('Invalid reset token'), { statusCode: 400 });
    }

    if (decoded.e < Date.now()) {
      throw Object.assign(new Error('Reset token has expired'), { statusCode: 400 });
    }

    const expected = createHmac('sha256', env.JWT_SECRET).update(`${decoded.u}:${decoded.e}`).digest('hex');
    if (decoded.s !== expected) {
      throw Object.assign(new Error('Invalid reset token'), { statusCode: 400 });
    }

    const user = await this.userService.findById(decoded.u);
    if (!user) {
      throw Object.assign(new Error('User not found'), { statusCode: 404 });
    }

    const newHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await this.userService.update(user.id, { password_hash: newHash } as Partial<UserRow>);

    // Revoke all refresh tokens
    await this.fastify.db('refresh_token').where({ user_id: user.id }).del();

    return { message: 'Password has been reset successfully' };
  }

  async login(email: string, password: string, platform: Platform = 'web') {
    const user = await this.userService.findByEmail(email);
    if (!user) {
      throw Object.assign(new Error('Invalid credentials'), { statusCode: 401 });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      throw Object.assign(new Error('Invalid credentials'), { statusCode: 401 });
    }

    // Le compte existe et le mot de passe est le bon : la personne a le droit
    // de savoir pourquoi elle n'entre pas. Avant le mot de passe, on ne dit
    // rien de plus qu'« identifiants incorrects », pour ne pas confirmer a un
    // tiers qu'une adresse a un compte.
    if (!user.is_active) {
      throw Object.assign(new Error('Ce compte est désactivé. Contactez votre administrateur.'), {
        statusCode: 403,
        name: 'AccountDisabled',
      });
    }

    // Un compte qui existait deja quand on l'a invite ne peut pas passer par le
    // lien d'invitation (l'adresse est prise). On honore ses invitations ici,
    // et on relit le compte si son organisation active a bascule.
    const joined = await this.invitationService.claimPendingForUser(user);
    const current = joined.length > 0 ? ((await this.userService.findById(user.id)) ?? user) : user;

    const tokens = await this.generateTokens(current, platform);
    const safeUser = toPublicUser(current);

    return { user: safeUser, ...tokens };
  }

  async refresh(refreshToken: string) {
    const stored = (await this.fastify.db('refresh_token').where({ token: refreshToken }).first()) as
      | RefreshTokenRow
      | undefined;
    if (!stored) {
      throw Object.assign(new Error('Invalid refresh token'), { statusCode: 401 });
    }
    // Le refresh renouvelle la session de la plateforme d'origine du jeton.
    const platform: Platform = stored.platform ?? 'web';

    if (stored.replaced_at) {
      return this.resumeReplacedSession(stored, platform);
    }

    if (Date.now() - new Date(stored.created_at).getTime() > REFRESH_MAX_IDLE_DAYS * 24 * 3600 * 1000) {
      await this.fastify.db('refresh_token').where({ id: stored.id }).del();
      throw Object.assign(new Error('Refresh token expired'), { statusCode: 401 });
    }

    const user = await this.userService.findById(stored.user_id);
    if (!user || !user.is_active) {
      throw Object.assign(new Error('User not found or inactive'), { statusCode: 401 });
    }

    return this.generateTokens(user, platform, stored.id);
  }

  /**
   * Un jeton deja remplace, rejoue pendant la tolerance : on redonne la
   * session en cours — meme identifiant de session, meme jeton vivant — pour
   * que l'appareil qui avait perdu la reponse se raccroche sans rien creer.
   */
  private async resumeReplacedSession(stored: RefreshTokenRow, platform: Platform) {
    const expired = Object.assign(new Error('Invalid refresh token'), { statusCode: 401 });
    if (Date.now() - new Date(stored.replaced_at as string).getTime() > REFRESH_REUSE_GRACE_MS) throw expired;

    const live = stored.replaced_by
      ? ((await this.fastify.db('refresh_token')
          .where({ token: stored.replaced_by })
          .whereNull('replaced_at')
          .first()) as RefreshTokenRow | undefined)
      : undefined;
    if (!live) throw expired;

    const sessionColumn = platform === 'mobile' ? 'current_mobile_session_id' : 'current_web_session_id';
    const user = (await this.fastify.db('user')
      .where({ id: stored.user_id })
      .select('id', 'email', 'is_active', sessionColumn)
      .first()) as { id: string; email: string; is_active: boolean; [k: string]: unknown } | undefined;
    const jti = user?.[sessionColumn];
    if (!user || !user.is_active || typeof jti !== 'string') throw expired;

    const accessToken = this.fastify.jwt.sign(
      { sub: user.id, email: user.email, jti, platform },
      { expiresIn: env.JWT_ACCESS_EXPIRES },
    );
    return { access_token: accessToken, refresh_token: live.token };
  }

  /**
   * Deconnecte l'utilisateur. Sans plateforme precisee (tokens anterieurs a la
   * separation des sessions), les deux sont coupees.
   */
  async logout(userId: string, platform?: Platform) {
    const sessionColumns = { mobile: 'current_mobile_session_id', web: 'current_web_session_id' } as const;

    if (platform) {
      await this.fastify.db('refresh_token').where({ user_id: userId, platform }).del();
      await this.fastify.db('user').where({ id: userId }).update({ [sessionColumns[platform]]: null });
    } else {
      await this.fastify.db('refresh_token').where({ user_id: userId }).del();
      await this.fastify
        .db('user')
        .where({ id: userId })
        .update({ current_mobile_session_id: null, current_web_session_id: null });
    }

    invalidateSessionCache(userId, platform);
    closeUserConnections(userId, 'logout', platform);
  }

  /**
   * `rotatedFromId` : le jeton de rafraichissement que cet appel remplace. Il
   * n'est pas supprime mais marque remplace, le temps de la tolerance de
   * reutilisation ; une connexion neuve (sans `rotatedFromId`) balaie tout.
   */
  private async generateTokens(user: UserRow, platform: Platform = 'web', rotatedFromId?: string) {
    const jti = randomUUID();
    const sessionColumn = platform === 'mobile' ? 'current_mobile_session_id' : 'current_web_session_id';

    // Une session active par plateforme : ce jti devient la session courante pour
    // CETTE plateforme. Un token portant un autre jti sera rejete par le middleware
    // d'auth, mais uniquement sur la meme plateforme — se connecter sur le mobile
    // ne deconnecte plus le dashboard.
    await this.fastify.db('user').where({ id: user.id }).update({ [sessionColumn]: jti });
    const purge = this.fastify.db('refresh_token').where({ user_id: user.id, platform });
    if (rotatedFromId) purge.whereNot({ id: rotatedFromId });
    await purge.del();
    // Les jetons remplaces dont la tolerance est passee ne servent plus a rien.
    await this.fastify
      .db('refresh_token')
      .where({ user_id: user.id })
      .whereNotNull('replaced_at')
      .where('replaced_at', '<', new Date(Date.now() - REFRESH_REUSE_GRACE_MS))
      .del();
    invalidateSessionCache(user.id, platform);
    // Une connexion neuve chasse l'appareil precedent de cette plateforme :
    // ses WebSocket recoivent le code 4001 et il se deconnecte. Un simple
    // renouvellement de jeton, lui, vient de l'appareil deja connecte : fermer
    // sa socket avec ce code le deconnectait toutes les quinze minutes, des
    // que l'app etait au premier plan au moment du renouvellement.
    if (!rotatedFromId) closeUserConnections(user.id, 'session-replaced', platform);

    const accessToken = this.fastify.jwt.sign(
      { sub: user.id, email: user.email, jti, platform },
      { expiresIn: env.JWT_ACCESS_EXPIRES },
    );

    const refreshToken = randomUUID();
    await this.fastify.db('refresh_token').insert({
      user_id: user.id,
      token: refreshToken,
      platform,
    });
    if (rotatedFromId) {
      await this.fastify
        .db('refresh_token')
        .where({ id: rotatedFromId })
        .update({ replaced_at: this.fastify.db.fn.now(), replaced_by: refreshToken });
    }

    return { access_token: accessToken, refresh_token: refreshToken };
  }
}

export default AuthService;
