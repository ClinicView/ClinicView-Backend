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
  DocumentClinicalMetadataDto,
  UpdateDocumentMetadataDto,
  normalizeDocumentMetadata,
} from './dto/document-metadata.dto';

@Injectable()
export class DocumentMetadataService {
  constructor(private readonly prisma: PrismaService) {}

  async history(patientId: string, documentId: string, beforeVersion?: number) {
    const doc = await this.prisma.medicalDocument.findFirst({
      where: { id: documentId, patientId },
      select: { id: true },
    });
    if (!doc) throw new NotFoundException('Documento no encontrado.');
    const rows = await this.prisma.documentMetadataRevision.findMany({
      where: {
        documentId,
        ...(beforeVersion !== undefined ? { version: { lt: beforeVersion } } : {}),
      },
      orderBy: { version: 'desc' },
      take: 21,
    });
    return {
      data: rows.slice(0, 20),
      nextBeforeVersion: rows.length > 20 ? rows[19].version : null,
    };
  }

  async update(
    patientId: string,
    documentId: string,
    dto: UpdateDocumentMetadataDto,
    actorId: string,
  ) {
    const metadata = normalizeDocumentMetadata(dto.metadata);
    if (dto.reason.trim().length < 5)
      throw new BadRequestException('Describe el motivo del cambio.');
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const doc = await tx.medicalDocument.findFirst({
            where: { id: documentId, patientId },
            include: { patient: { select: { isActive: true } } },
          });
          if (!doc) throw new NotFoundException('Documento no encontrado.');
          if (!doc.patient.isActive) throw new ConflictException('El paciente está inactivo.');
          if (doc.version !== dto.expectedVersion || doc.status === 'PROCESSING')
            throw new ConflictException(
              'El documento cambió o está procesándose. Recarga antes de guardar.',
            );
          if (doc.assignedReviewerId && doc.assignedReviewerId !== actorId)
            throw new ConflictException('El documento está asignado a otro revisor.');
          const actor = await tx.user.findUnique({
            where: { id: actorId },
            select: { isActive: true, fullName: true, username: true },
          });
          if (!actor?.isActive)
            throw new UnauthorizedException('No se pudo identificar al revisor activo.');
          const previous = await tx.documentMetadataRevision.findFirst({
            where: { documentId },
            select: { id: true },
          });
          if (!previous)
            await tx.documentMetadataRevision.create({
              data: {
                documentId,
                version: doc.version,
                metadata: doc.clinicalMetadata as Prisma.InputJsonObject,
                reason: 'Metadatos previos al primer cambio trazado.',
                recordedBy: doc.createdBy,
                recordedByName: null,
                createdAt: doc.createdAt,
              },
            });
          const updated = await tx.medicalDocument.update({
            where: { id: documentId, patientId, version: dto.expectedVersion },
            data: {
              clinicalMetadata: metadata as Prisma.InputJsonObject,
              updatedBy: actorId,
              version: { increment: 1 },
            },
            select: { id: true, version: true, clinicalMetadata: true },
          });
          await tx.documentMetadataRevision.create({
            data: {
              documentId,
              version: updated.version,
              metadata: metadata as Prisma.InputJsonObject,
              reason: dto.reason.trim(),
              recordedBy: actorId,
              recordedByName: actor.fullName || actor.username,
            },
          });
          return {
            ...updated,
            clinicalMetadata: updated.clinicalMetadata as DocumentClinicalMetadataDto,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        ['P2002', 'P2034', 'P2025'].includes(String(error.code))
      )
        throw new ConflictException(
          'El documento cambió durante la operación. Recarga antes de guardar.',
        );
      throw error;
    }
  }
}
