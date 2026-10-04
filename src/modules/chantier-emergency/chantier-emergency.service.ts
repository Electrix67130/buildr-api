import { Knex } from 'knex';
import BaseService, { PaginationOptions, PaginatedResult } from '@/lib/base-service';
import { EmergencyRow, EmergencyPhoto, EmergencyPhotoInput } from './chantier-emergency.schema';

class ChantierEmergencyService extends BaseService<EmergencyRow> {
  constructor(db: Knex) {
    super(db, 'chantier_emergency');
  }

  async findByChantier(
    chantierId: string,
    options: PaginationOptions = {},
  ): Promise<PaginatedResult<EmergencyRow & { first_name: string; last_name: string; type: 'emergency' | 'claim' }>> {
    const { page = 1, limit = 20, orderBy = 'created_at', order = 'desc' } = options;
    const offset = (page - 1) * limit;

    const baseQuery = this.db(this.table)
      .join('user', 'chantier_emergency.created_by', 'user.id')
      .leftJoin('chantier_member', function () {
        this.on('chantier_member.user_id', '=', 'chantier_emergency.created_by').andOn(
          'chantier_member.chantier_id',
          '=',
          'chantier_emergency.chantier_id',
        );
      })
      .where('chantier_emergency.chantier_id', chantierId);

    const [rows, [{ count }]] = await Promise.all([
      baseQuery
        .clone()
        .select(
          'chantier_emergency.*',
          'user.first_name',
          'user.last_name',
          'chantier_member.role as member_role',
        )
        .orderBy(`chantier_emergency.${orderBy}`, order)
        .limit(limit)
        .offset(offset),
      baseQuery.clone().count('* as count') as Promise<{ count: string }[]>,
    ]);

    const typed = rows as Array<EmergencyRow & { first_name: string; last_name: string; member_role: string | null }>;
    const photos = await this.photosFor(typed.map((r) => r.id));

    // Mapping : auteur membre client -> reclamation, sinon urgence (admin/createur/manager/ouvrier).
    const items = typed.map(({ member_role, ...rest }) => ({
      ...rest,
      type: (member_role === 'client' ? 'claim' : 'emergency') as 'emergency' | 'claim',
      photos: photos.get(rest.id) ?? [],
    }));

    return {
      data: items,
      meta: {
        total: parseInt(count, 10),
        page,
        limit,
        totalPages: Math.ceil(parseInt(count, 10) / limit),
      },
    };
  }

  /** Les photos de chaque urgence, en une requete, dans l'ordre d'ajout. */
  async photosFor(emergencyIds: string[]): Promise<Map<string, EmergencyPhoto[]>> {
    const map = new Map<string, EmergencyPhoto[]>();
    if (emergencyIds.length === 0) return map;
    const rows = (await this.db('photo')
      .whereIn('emergency_id', emergencyIds)
      .select('id', 'url', 'thumbnail_url', 'emergency_id', 'created_at')
      .orderBy('created_at', 'asc')) as (EmergencyPhoto & { emergency_id: string })[];
    for (const { emergency_id, ...photo } of rows) {
      map.set(emergency_id, [...(map.get(emergency_id) ?? []), photo]);
    }
    return map;
  }

  /**
   * Rattache des photos a une urgence. Elles entrent dans la galerie du
   * chantier comme les autres. Si l'urgence n'avait pas encore de `photo_url`,
   * la premiere le devient, pour les clients qui ne lisent que ce champ.
   */
  async addPhotos(emergency: EmergencyRow, uploaderId: string, photos: EmergencyPhotoInput[]): Promise<EmergencyPhoto[]> {
    if (photos.length > 0) {
      await this.db('photo').insert(
        photos.map((p) => ({
          chantier_id: emergency.chantier_id,
          uploaded_by: uploaderId,
          emergency_id: emergency.id,
          url: p.url,
          thumbnail_url: p.thumbnail_url ?? null,
          file_size: p.file_size ?? null,
          mime_type: p.mime_type ?? null,
        })),
      );
      if (!emergency.photo_url) {
        await this.db(this.table)
          .where({ id: emergency.id })
          .update({ photo_url: photos[0].url, thumbnail_url: photos[0].thumbnail_url ?? null, updated_at: this.db.fn.now() });
      }
    }
    return (await this.photosFor([emergency.id])).get(emergency.id) ?? [];
  }
}

export default ChantierEmergencyService;
