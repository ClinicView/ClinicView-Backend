import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import {
  ClinicalSummaryPayloadDto,
  ClinicalSummaryResponseDto,
  EMPTY_CLINICAL_SUMMARY,
  ReconciliationStatus,
  SaveClinicalSummaryDto,
} from './dto/clinical-summary.dto';

export function normalizeClinicalSummary(dto: SaveClinicalSummaryDto): ClinicalSummaryPayloadDto {
  for (const [status, entries] of [
    [dto.allergyStatus, dto.allergies],
    [dto.problemStatus, dto.problems],
    [dto.medicationStatus, dto.medications],
  ] as const) {
    if ((status === ReconciliationStatus.RECORDED) !== entries.length > 0) {
      throw new BadRequestException(
        'El estado «Registrado» requiere elementos; los demás estados requieren una lista vacía.',
      );
    }
    if (new Set(entries.map((entry) => entry.id)).size !== entries.length) {
      throw new BadRequestException('No se permiten identificadores repetidos en la misma lista.');
    }
    for (const entry of entries) {
      if (
        !entry.name.trim() ||
        ('reaction' in entry && !entry.reaction.trim()) ||
        ('regimen' in entry && !entry.regimen.trim())
      ) {
        throw new BadRequestException(
          'Completa los nombres, reacciones y pautas de los elementos registrados.',
        );
      }
    }
  }
  if (dto.reason.trim().length < 5)
    throw new BadRequestException('Describe el motivo y la fuente de la actualización.');
  return {
    allergyStatus: dto.allergyStatus,
    allergies: dto.allergies,
    problemStatus: dto.problemStatus,
    problems: dto.problems,
    medicationStatus: dto.medicationStatus,
    medications: dto.medications,
  };
}

@Injectable()
export class ClinicalSummaryService {
  constructor(private readonly prisma: PrismaService) {}

  async current(patientId: string): Promise<ClinicalSummaryResponseDto> {
    const patient = await this.prisma.patient.findUnique({
      where: { id: patientId },
      select: { id: true },
    });
    if (!patient) throw new NotFoundException('Paciente no encontrado.');
    const revision = await this.prisma.patientClinicalSummaryRevision.findFirst({
      where: { patientId },
      orderBy: { version: 'desc' },
    });
    return revision
      ? { ...revision, payload: revision.payload as unknown as ClinicalSummaryPayloadDto }
      : {
          version: 0,
          payload: EMPTY_CLINICAL_SUMMARY,
          recordedByName: null,
          recordedBy: null,
          reason: null,
          createdAt: null,
        };
  }

  async history(patientId: string, beforeVersion?: number) {
    await this.current(patientId);
    const rows = await this.prisma.patientClinicalSummaryRevision.findMany({
      where: { patientId, ...(beforeVersion ? { version: { lt: beforeVersion } } : {}) },
      orderBy: { version: 'desc' },
      take: 21,
    });
    return {
      data: rows.slice(0, 20),
      nextBeforeVersion: rows.length > 20 ? rows[19].version : null,
    };
  }

  async save(
    patientId: string,
    dto: SaveClinicalSummaryDto,
    actorId: string,
  ): Promise<ClinicalSummaryResponseDto> {
    const payload = normalizeClinicalSummary(dto);
    try {
      const revision = await this.prisma.$transaction(
        async (tx) => {
          const actor = await tx.user.findUnique({
            where: { id: actorId },
            select: { isActive: true, fullName: true, username: true },
          });
          if (!actor?.isActive)
            throw new UnauthorizedException('No se pudo identificar al profesional activo.');
          const patient = await tx.patient.findUnique({
            where: { id: patientId },
            select: { isActive: true },
          });
          if (!patient) throw new NotFoundException('Paciente no encontrado.');
          if (!patient.isActive)
            throw new BadRequestException(
              'Reactiva al paciente antes de actualizar su información clínica.',
            );
          const latest = await tx.patientClinicalSummaryRevision.findFirst({
            where: { patientId },
            orderBy: { version: 'desc' },
            select: { version: true },
          });
          if ((latest?.version ?? 0) !== dto.expectedVersion)
            throw new ConflictException(
              'La información clínica cambió. Recarga y revisa antes de guardar.',
            );
          // Lock the patient against concurrent deactivation within this transaction.
          await tx.patient.update({
            where: { id: patientId, isActive: true },
            data: { version: { increment: 1 }, updatedBy: actorId },
          });
          return tx.patientClinicalSummaryRevision.create({
            data: {
              patientId,
              version: dto.expectedVersion + 1,
              payload: JSON.parse(JSON.stringify(payload)) as Prisma.InputJsonObject,
              reason: dto.reason.trim(),
              recordedBy: actorId,
              recordedByName: actor.fullName || actor.username,
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return { ...revision, payload: revision.payload as unknown as ClinicalSummaryPayloadDto };
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        ['P2002', 'P2034', 'P2025'].includes(String(error.code))
      ) {
        throw new ConflictException(
          'La información del paciente cambió. Recarga y revisa antes de guardar.',
        );
      }
      throw error;
    }
  }
}
