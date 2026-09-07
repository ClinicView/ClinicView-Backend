import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import {
  databaseDateToDateOnly,
  dateOnlyToDatabaseDate,
} from '../../common/validation/clinical-date';
import {
  AssignEpisodeDto,
  CreateEpisodeDto,
  EpisodePageQueryDto,
  EpisodeTransitionDto,
  UpdateEpisodeDto,
} from './episode.dto';
import {
  activeEpisodePatient,
  assertEpisodeDate,
  episodeActor,
  episodeConflict,
  episodeResponse,
  lockOpenEpisode,
} from './episode-state';

@Injectable()
export class ClinicalEpisodesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(patientId: string, query: EpisodePageQueryDto) {
    const page = query.page ?? 1;
    const limit = 20;
    return this.prisma.$transaction(
      async (tx) => {
        const where = { patientId, ...(query.status ? { status: query.status } : {}) };
        const [episodes, total] = await Promise.all([
          tx.clinicalEpisode.findMany({
            where,
            orderBy: [{ startedOn: 'desc' }, { id: 'desc' }],
            skip: (page - 1) * limit,
            take: limit,
            include: { _count: { select: { records: true } } },
          }),
          tx.clinicalEpisode.count({ where }),
        ]);
        const ids = episodes.map((episode) => episode.id);
        const [active, pending] = await Promise.all([
          tx.clinicalRecord.groupBy({
            by: ['episodeId'],
            where: { episodeId: { in: ids }, status: 'ACTIVE' },
            _count: true,
          }),
          tx.clinicalRecord.groupBy({
            by: ['episodeId'],
            where: { episodeId: { in: ids }, status: 'ACTIVE', confirmation: null },
            _count: true,
          }),
        ]);
        return {
          data: episodes.map((episode) => ({
            ...episodeResponse(episode)!,
            recordsCount: episode._count.records,
            activeCount: active.find((row) => row.episodeId === episode.id)?._count ?? 0,
            pendingConfirmationCount:
              pending.find((row) => row.episodeId === episode.id)?._count ?? 0,
          })),
          total,
          page,
          limit,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async create(patientId: string, dto: CreateEpisodeDto, actorId: string) {
    return this.prisma
      .$transaction(async (tx) => {
        await activeEpisodePatient(tx, patientId);
        const actorName = await episodeActor(tx, actorId);
        const episode = await tx.clinicalEpisode.create({
          data: {
            patientId,
            title: dto.title,
            description: dto.description || null,
            startedOn: dateOnlyToDatabaseDate(dto.startedOn),
          },
        });
        const snapshot = episodeResponse(episode)!;
        await tx.clinicalEpisodeEvent.create({
          data: {
            episodeId: episode.id,
            actorId,
            actorName,
            action: 'CREATE',
            reason: dto.reason,
            payload: { after: { ...snapshot } },
          },
        });
        return snapshot;
      })
      .catch(episodeConflict);
  }

  async update(patientId: string, id: string, dto: UpdateEpisodeDto, actorId: string) {
    return this.prisma
      .$transaction(
        async (tx) => {
          await activeEpisodePatient(tx, patientId);
          const original = await lockOpenEpisode(tx, patientId, id);
          if (original.version !== dto.expectedVersion)
            throw new ConflictException('El episodio cambió. Recarga antes de editar.');
          const earliest = await tx.clinicalRecord.findFirst({
            where: { episodeId: id, status: 'ACTIVE' },
            orderBy: { attendedAt: 'asc' },
            select: { attendedAt: true },
          });
          const startedOn = dateOnlyToDatabaseDate(dto.startedOn);
          if (earliest) assertEpisodeDate({ ...original, startedOn }, earliest.attendedAt);
          const actorName = await episodeActor(tx, actorId);
          const updated = await tx.clinicalEpisode.update({
            where: { id, version: dto.expectedVersion },
            data: {
              title: dto.title,
              description: dto.description || null,
              startedOn,
              version: { increment: 1 },
            },
          });
          await tx.clinicalEpisodeEvent.create({
            data: {
              episodeId: id,
              actorId,
              actorName,
              action: 'UPDATE',
              reason: dto.reason,
              payload: {
                before: { ...episodeResponse(original)! },
                after: { ...episodeResponse(updated)! },
              },
            },
          });
          return episodeResponse(updated)!;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      )
      .catch(episodeConflict);
  }

  async transition(patientId: string, id: string, dto: EpisodeTransitionDto, actorId: string) {
    return this.prisma
      .$transaction(
        async (tx) => {
          await activeEpisodePatient(tx, patientId);
          await tx.$queryRaw`SELECT id FROM clinical_episodes WHERE id = ${id}::uuid AND patient_id = ${patientId}::uuid FOR UPDATE`;
          const original = await tx.clinicalEpisode.findFirst({ where: { id, patientId } });
          if (!original) throw new NotFoundException('Episodio no encontrado.');
          const closing = dto.action === 'CLOSE';
          if (dto.attested !== true)
            throw new BadRequestException('Confirma el cambio del episodio.');
          if (
            original.version !== dto.expectedVersion ||
            original.status !== (closing ? 'OPEN' : 'CLOSED')
          )
            throw new ConflictException('El episodio cambió o no admite esta transición.');
          if (!closing && dto.endedOn)
            throw new BadRequestException('La reapertura deja la fecha de cierre vacía.');
          const endedOn = closing && dto.endedOn ? dateOnlyToDatabaseDate(dto.endedOn) : null;
          if (closing) {
            if (
              !endedOn ||
              databaseDateToDateOnly(endedOn) < databaseDateToDateOnly(original.startedOn)
            )
              throw new BadRequestException(
                'La fecha de cierre debe ser igual o posterior al inicio.',
              );
            const active = await tx.clinicalRecord.count({
              where: { episodeId: id, status: 'ACTIVE' },
            });
            const pending = await tx.clinicalRecord.count({
              where: { episodeId: id, status: 'ACTIVE', confirmation: null },
            });
            if (!active || pending)
              throw new ConflictException(
                'El cierre requiere al menos una atención vigente y todas confirmadas.',
              );
            const last = await tx.clinicalRecord.findFirst({
              where: { episodeId: id, status: 'ACTIVE' },
              orderBy: { attendedAt: 'desc' },
              select: { attendedAt: true },
            });
            if (last) assertEpisodeDate({ ...original, endedOn }, last.attendedAt);
          }
          const actorName = await episodeActor(tx, actorId);
          const updated = await tx.clinicalEpisode.update({
            where: { id, version: dto.expectedVersion },
            data: { status: closing ? 'CLOSED' : 'OPEN', endedOn, version: { increment: 1 } },
          });
          await tx.clinicalEpisodeEvent.create({
            data: {
              episodeId: id,
              actorId,
              actorName,
              action: dto.action,
              reason: dto.reason,
              payload: {
                before: { ...episodeResponse(original)! },
                after: { ...episodeResponse(updated)! },
              },
            },
          });
          return episodeResponse(updated)!;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      )
      .catch(episodeConflict);
  }

  async assign(patientId: string, recordId: string, dto: AssignEpisodeDto, actorId: string) {
    return this.prisma
      .$transaction(
        async (tx) => {
          await activeEpisodePatient(tx, patientId);
          const record = await tx.clinicalRecord.findFirst({ where: { id: recordId, patientId } });
          if (!record) throw new NotFoundException('Atención no encontrada.');
          if (record.version !== dto.expectedRecordVersion || record.status !== 'ACTIVE')
            throw new ConflictException('Solo se puede agrupar una versión vigente y actualizada.');
          if (record.episodeId === dto.episodeId)
            throw new BadRequestException('La atención ya tiene esa agrupación.');
          const ids = [
            ...new Set([record.episodeId, dto.episodeId].filter((id): id is string => Boolean(id))),
          ].sort();
          for (const id of ids) {
            const episode = await lockOpenEpisode(tx, patientId, id);
            if (id === dto.episodeId) assertEpisodeDate(episode, record.attendedAt);
          }
          const actorName = await episodeActor(tx, actorId);
          const changed = await tx.clinicalRecord.updateMany({
            where: {
              id: recordId,
              patientId,
              status: 'ACTIVE',
              version: dto.expectedRecordVersion,
            },
            data: { episodeId: dto.episodeId, version: { increment: 1 }, updatedBy: actorId },
          });
          if (changed.count !== 1)
            throw new ConflictException('La atención cambió; no se modificó la agrupación.');
          for (const id of ids) {
            await tx.clinicalEpisode.update({ where: { id }, data: { version: { increment: 1 } } });
            await tx.clinicalEpisodeEvent.create({
              data: {
                episodeId: id,
                recordId,
                actorId,
                actorName,
                action: id === dto.episodeId ? 'ATTACH' : 'DETACH',
                reason: dto.reason,
                payload: {
                  fromEpisodeId: record.episodeId,
                  toEpisodeId: dto.episodeId,
                  recordVersion: record.version,
                },
              },
            });
          }
          return { recordId, episodeId: dto.episodeId, version: record.version + 1 };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      )
      .catch(episodeConflict);
  }

  async history(patientId: string, episodeId: string, page = 1) {
    return this.prisma.$transaction(
      async (tx) => {
        if (!(await tx.clinicalEpisode.findFirst({ where: { id: episodeId, patientId } })))
          throw new NotFoundException('Episodio no encontrado.');
        const [data, total] = await Promise.all([
          tx.clinicalEpisodeEvent.findMany({
            where: { episodeId },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            skip: (page - 1) * 20,
            take: 20,
          }),
          tx.clinicalEpisodeEvent.count({ where: { episodeId } }),
        ]);
        return { data, total, page, limit: 20 };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
