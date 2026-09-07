import { ConflictException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ClinicalEpisode, Prisma } from '@prisma/client';
import {
  currentDateOnlyInClinicalTimeZone,
  databaseDateToDateOnly,
} from '../../common/validation/clinical-date';
import { EpisodeDto } from './episode.dto';

export function episodeResponse(value?: ClinicalEpisode | null): EpisodeDto | null {
  return value
    ? {
        id: value.id,
        patientId: value.patientId,
        title: value.title,
        description: value.description,
        startedOn: databaseDateToDateOnly(value.startedOn),
        endedOn: value.endedOn ? databaseDateToDateOnly(value.endedOn) : null,
        status: value.status,
        version: value.version,
      }
    : null;
}
export async function episodeActor(tx: Prisma.TransactionClient, actorId: string): Promise<string> {
  const actor = await tx.user.findUnique({
    where: { id: actorId },
    select: { isActive: true, fullName: true, username: true },
  });
  if (!actor?.isActive) throw new UnauthorizedException('El usuario debe estar activo.');
  return `${actor.fullName || actor.username} · @${actor.username}`;
}
export async function activeEpisodePatient(
  tx: Prisma.TransactionClient,
  patientId: string,
): Promise<void> {
  const patient = await tx.patient.findUnique({
    where: { id: patientId },
    select: { isActive: true },
  });
  if (!patient) throw new NotFoundException('Paciente no encontrado.');
  if (!patient.isActive)
    throw new ConflictException('Reactiva al paciente antes de modificar el episodio.');
}
export function assertEpisodeDate(episode: ClinicalEpisode, date: Date): void {
  const day = currentDateOnlyInClinicalTimeZone(date);
  if (
    day < databaseDateToDateOnly(episode.startedOn) ||
    (episode.endedOn && day > databaseDateToDateOnly(episode.endedOn))
  )
    throw new ConflictException('La fecha de atención queda fuera del período del episodio.');
}
/** Locks acquired in ID order by callers when moving between episodes. */
export async function lockOpenEpisode(
  tx: Prisma.TransactionClient,
  patientId: string,
  id: string,
): Promise<ClinicalEpisode> {
  await tx.$queryRaw`SELECT id FROM clinical_episodes WHERE id = ${id}::uuid AND patient_id = ${patientId}::uuid FOR UPDATE`;
  const episode = await tx.clinicalEpisode.findFirst({ where: { id, patientId } });
  if (!episode) throw new NotFoundException('Episodio no encontrado para este paciente.');
  if (episode.status !== 'OPEN')
    throw new ConflictException(
      'El episodio está cerrado. Reábrelo con motivo antes de modificar sus atenciones.',
    );
  return episode;
}
export async function traceEpisodeRecordChange(
  tx: Prisma.TransactionClient,
  patientId: string,
  episodeId: string | null | undefined,
  recordId: string,
  actorId: string,
  action: 'CORRECT' | 'VOID',
  date?: Date,
): Promise<void> {
  if (!episodeId) return;
  await activeEpisodePatient(tx, patientId);
  const episode = await lockOpenEpisode(tx, patientId, episodeId);
  if (date) assertEpisodeDate(episode, date);
  const actorName = await episodeActor(tx, actorId);
  await tx.clinicalEpisode.update({
    where: { id: episodeId },
    data: { version: { increment: 1 } },
  });
  await tx.clinicalEpisodeEvent.create({
    data: {
      episodeId,
      recordId,
      actorId,
      actorName,
      action,
      reason:
        action === 'CORRECT'
          ? 'Nueva versión de una atención del episodio.'
          : 'Anulación de una atención; motivo conservado en el registro.',
      payload: {},
    },
  });
}
export function episodeConflict(error: unknown): never {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    ['P2002', 'P2025', 'P2034'].includes(String(error.code))
  )
    throw new ConflictException(
      'El episodio o la atención cambió. Recarga y revisa antes de continuar.',
    );
  throw error;
}
