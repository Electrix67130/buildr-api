import { Knex } from 'knex';
import { TeamMemberRow } from './team.schema';

class TeamService {
  private db: Knex;

  constructor(db: Knex) {
    this.db = db;
  }

  /** Get all members of a manager's team (with user info) */
  async getTeam(managerId: string) {
    return this.db('team_member')
      .join('user', 'team_member.user_id', 'user.id')
      .where('team_member.manager_id', managerId)
      .select(
        'team_member.id',
        'team_member.manager_id',
        'team_member.user_id',
        'team_member.created_at',
        'user.first_name',
        'user.last_name',
        'user.email',
        'user.phone',
        'user.role',
        'user.company_name',
      );
  }

  /** Add a user to a manager's team */
  async addMember(managerId: string, userId: string): Promise<TeamMemberRow> {
    const [row] = await this.db('team_member')
      .insert({ manager_id: managerId, user_id: userId })
      .returning('*');
    return row;
  }

  /** Remove a user from a manager's team */
  async removeMember(id: string): Promise<boolean> {
    const count = await this.db('team_member').where({ id }).del();
    return count > 0;
  }

  /** Find a specific team membership */
  async findOne(managerId: string, userId: string): Promise<TeamMemberRow | undefined> {
    return this.db('team_member').where({ manager_id: managerId, user_id: userId }).first();
  }

  /** Get all user IDs in a manager's team */
  async getTeamUserIds(managerId: string): Promise<string[]> {
    const rows = await this.db('team_member').where({ manager_id: managerId }).select('user_id');
    return rows.map((r: { user_id: string }) => r.user_id);
  }
}

export default TeamService;
