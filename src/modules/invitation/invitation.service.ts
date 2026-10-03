import { Knex } from 'knex';
import { randomUUID } from 'crypto';
import BaseService from '@/lib/base-service';
import { InvitationRow, CreateInvitation } from './invitation.schema';
import { sendMail, buildInvitationEmail } from '@/lib/mailer';

const EXPIRES_IN_DAYS = 7;

/**
 * Ce que le rattachement a besoin de savoir du compte qui se connecte.
 * `active_organization_id` est optionnel car `UserRow` ne le declare pas
 * encore, bien que la colonne soit toujours lue depuis la base.
 */
export type ClaimableUser = {
  id: string;
  email: string;
  active_organization_id?: string | null;
};

class InvitationService extends BaseService<InvitationRow> {
  constructor(db: Knex) {
    super(db, 'invitation');
  }

  /** Create a new invitation with a unique token and send email */
  async invite(data: CreateInvitation, invitedBy: string): Promise<InvitationRow> {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + EXPIRES_IN_DAYS);

    // Copy the inviter's ACTIVE organization_id so the invited user joins the right org
    const inviter = await this.db('user').where({ id: invitedBy }).first();
    if (!inviter?.active_organization_id) {
      throw Object.assign(new Error('Inviter has no active organization'), { statusCode: 400 });
    }

    const invitation = await this.create({
      email: data.email,
      invited_by: invitedBy,
      role: data.role,
      token: randomUUID(),
      status: 'pending',
      expires_at: expiresAt.toISOString(),
      organization_id: inviter.active_organization_id,
      locale: data.locale,
    } as Partial<InvitationRow>);

    // Build inviter name for the email (reuse earlier fetched row)
    const inviterName = `${inviter.first_name} ${inviter.last_name}`;

    // Send invitation email
    const { subject, html } = buildInvitationEmail({
      inviterName,
      email: data.email,
      role: data.role || 'employee',
      token: invitation.token,
      expiresAt: invitation.expires_at,
      locale: invitation.locale,
    });

    await sendMail({ to: data.email, subject, html });

    return invitation;
  }

  /** Find a pending invitation by token */
  async findByToken(token: string): Promise<InvitationRow | undefined> {
    return this.findOne({ token, status: 'pending' } as Partial<InvitationRow>);
  }

  /** Accept an invitation */
  async accept(id: string): Promise<InvitationRow | undefined> {
    const [row] = await this.db(this.table)
      .where({ id })
      .update({ status: 'accepted' })
      .returning('*');
    return row as InvitationRow | undefined;
  }

  /**
   * Honore une invitation pour un compte existant : membership dans
   * l'organisation invitante avec le role de l'invitation, invitation marquee
   * acceptee, et entree dans l'equipe de l'inviteur si celui-ci est manager.
   *
   * C'est le seul endroit ou une invitation se transforme en appartenance.
   * L'inscription et la connexion passent toutes deux par ici, pour que les
   * deux parcours ne divergent jamais.
   */
  async redeem(invitation: InvitationRow, userId: string): Promise<void> {
    await this.db('organization_member')
      .insert({ organization_id: invitation.organization_id, user_id: userId, role: invitation.role })
      .onConflict(['organization_id', 'user_id'])
      .ignore();

    await this.db(this.table).where({ id: invitation.id }).update({ status: 'accepted' });

    const inviterMembership = await this.db('organization_member')
      .where({ user_id: invitation.invited_by, organization_id: invitation.organization_id })
      .first();
    if (inviterMembership?.role === 'manager') {
      await this.db('team_member')
        .insert({ manager_id: invitation.invited_by, user_id: userId })
        .onConflict(['manager_id', 'user_id'])
        .ignore();
    }
  }

  /**
   * Rattache un compte existant aux organisations qui l'ont invite.
   *
   * Le parcours nominal cree le compte depuis le lien d'invitation. Mais un
   * collaborateur s'inscrit parfois de lui-meme avant que son employeur ne
   * l'invite, ou avait deja un compte : l'inscription par le lien repond alors
   * « adresse deja utilisee » et l'invitation reste en attente sans que
   * personne ne puisse rien faire. Ici, a la connexion, on honore toute
   * invitation en attente et non expiree adressee a son e-mail.
   *
   * Si le compte vivait jusque-la dans une organisation coquille — creee pour
   * lui a l'inscription, dont il est le seul membre et qui n'a aucun chantier —
   * son organisation active bascule vers celle qui l'a invite : c'est la qu'il
   * voulait aller. Sinon on ne touche pas a son contexte, il changera depuis
   * le selecteur d'organisation.
   *
   * Renvoie les identifiants des organisations rejointes, dans l'ordre des
   * invitations.
   */
  async claimPendingForUser(user: ClaimableUser): Promise<string[]> {
    const pending = (await this.db(this.table)
      .whereRaw('lower(email) = lower(?)', [user.email])
      .where('status', 'pending')
      .where('expires_at', '>', this.db.fn.now())
      .orderBy('created_at', 'asc')) as InvitationRow[];
    if (pending.length === 0) return [];

    const joined: string[] = [];
    for (const invitation of pending) {
      const already = await this.db('organization_member')
        .where({ user_id: user.id, organization_id: invitation.organization_id })
        .first();
      await this.redeem(invitation, user.id);
      if (!already) joined.push(invitation.organization_id);
    }
    if (joined.length === 0) return [];

    const shell = !user.active_organization_id || (await this.isEmptyShell(user.active_organization_id, user.id));
    if (shell) {
      const target = joined[joined.length - 1];
      await this.db('user')
        .where({ id: user.id })
        .update({ active_organization_id: target, organization_id: target });
    }
    return joined;
  }

  /** Une organisation dont `userId` est le seul membre et qui n'a aucun chantier. */
  private async isEmptyShell(organizationId: string, userId: string): Promise<boolean> {
    const otherMember = await this.db('organization_member')
      .where({ organization_id: organizationId })
      .whereNot({ user_id: userId })
      .first();
    if (otherMember) return false;
    const chantier = await this.db('chantier').where({ organization_id: organizationId }).first();
    return !chantier;
  }

  /** Expire old invitations */
  async expireOld(): Promise<number> {
    return this.db(this.table)
      .where('status', 'pending')
      .where('expires_at', '<', this.db.fn.now())
      .update({ status: 'expired' });
  }
}

export default InvitationService;
