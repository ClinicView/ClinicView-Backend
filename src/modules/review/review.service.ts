import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DocumentStatus, ReviewPriority } from '@prisma/client';
import {
  ReviewRepository,
  type ReviewQueueDocument,
} from './repositories/review.repository';
import { FindReviewQueueQueryDto } from './dto/find-review-queue-query.dto';
import {
  ReviewAssigneesResponseDto,
  ReviewAssignmentResponseDto,
  ReviewQueueItemDto,
  ReviewQueuePageDto,
} from './dto/review-queue-item.dto';
import {
  AssignReviewDocumentDto,
  UpdateReviewPriorityDto,
} from './dto/review-assignment.dto';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class ReviewService {
  private readonly logger = new Logger(ReviewService.name);

  constructor(
    private readonly repo: ReviewRepository,
    private readonly notifications: NotificationsService,
  ) {}

  async getQueue(query: FindReviewQueueQueryDto, actorId: string): Promise<ReviewQueuePageDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { items, total } = await this.repo.findQueue({
      page,
      limit,
      actorId,
      scope: query.scope ?? 'AVAILABLE',
      ...(query.priority && { priority: query.priority as ReviewPriority }),
    });

    return {
      data: items.map((item): ReviewQueueItemDto => ({
        id: item.id,
        originalName: item.originalName,
        mimeType: item.mimeType,
        sizeBytes: item.sizeBytes,
        processedAt: item.processedAt,
        createdAt: item.createdAt,
        reviewPriority: item.reviewPriority,
        version: item.version,
        assignmentState: !item.assignedReviewerId
          ? 'UNASSIGNED'
          : item.assignedReviewerId === actorId
            ? 'MINE'
            : 'ASSIGNED',
        assignedAt: item.assignedAt,
        assignee: item.assignedReviewer,
        patient: {
          id: item.patient.id,
          firstName: item.patient.firstName,
          lastName: item.patient.lastName,
          documentType: item.patient.documentType,
          documentNumber: item.patient.documentNumber,
        },
      })),
      total,
      page,
      limit,
    };
  }

  async listAssignees(query: string): Promise<ReviewAssigneesResponseDto> {
    return { data: await this.repo.findEligibleAssignees(query.trim()) };
  }

  async claim(
    documentId: string,
    expectedVersion: number,
    actorId: string,
  ): Promise<ReviewAssignmentResponseDto> {
    await this.ensureEligibleAssignee(actorId);
    const current = await this.requirePendingReview(documentId);
    if (current.assignedReviewerId) {
      throw new ConflictException('El documento ya fue tomado por otro revisor.');
    }

    const updated = await this.repo.claim(documentId, actorId, expectedVersion);
    if (!updated) throw this.concurrentChange();
    return this.toAssignmentResponse(updated);
  }

  async assign(
    documentId: string,
    dto: AssignReviewDocumentDto,
    actorId: string,
  ): Promise<ReviewAssignmentResponseDto> {
    await this.ensureEligibleAssignee(dto.assigneeId);
    await this.requirePendingReview(documentId);
    const updated = await this.repo.assign(
      documentId,
      dto.assigneeId,
      dto.expectedVersion,
      actorId,
    );
    if (!updated) throw this.concurrentChange();

    if (dto.assigneeId !== actorId) {
      try {
        await this.notifications.notify({
          userId: dto.assigneeId,
          type: 'DOCUMENT_REVIEW_ASSIGNED',
          title: 'Nueva revisión asignada',
          body: `Se te asignó el documento «${updated.originalName}» para revisión clínica.`,
          patientId: updated.patientId,
          documentId: updated.id,
        });
      } catch {
        // La asignación ya fue confirmada: una alerta secundaria no debe convertirla en error.
        this.logger.warn('No se pudo notificar una asignación de revisión ya confirmada.');
      }
    }
    return this.toAssignmentResponse(updated);
  }

  async release(
    documentId: string,
    expectedVersion: number,
    actorId: string,
  ): Promise<ReviewAssignmentResponseDto> {
    const current = await this.requirePendingReview(documentId);
    if (!current.assignedReviewerId) {
      throw new ConflictException('El documento ya se encuentra sin asignar.');
    }
    const updated = await this.repo.release(documentId, expectedVersion, actorId);
    if (!updated) throw this.concurrentChange();
    return this.toAssignmentResponse(updated);
  }

  async updatePriority(
    documentId: string,
    dto: UpdateReviewPriorityDto,
    actorId: string,
  ): Promise<ReviewAssignmentResponseDto> {
    await this.requirePendingReview(documentId);
    const updated = await this.repo.updatePriority(
      documentId,
      dto.priority as ReviewPriority,
      dto.expectedVersion,
      actorId,
    );
    if (!updated) throw this.concurrentChange();
    return this.toAssignmentResponse(updated);
  }

  private async requirePendingReview(documentId: string) {
    const document = await this.repo.findDocument(documentId);
    if (!document) throw new NotFoundException('Documento no encontrado.');
    if (document.status !== DocumentStatus.PROCESSED) {
      throw new ConflictException('Solo se pueden asignar documentos pendientes de revisión.');
    }
    return document;
  }

  private async ensureEligibleAssignee(userId: string): Promise<void> {
    if (!(await this.repo.isEligibleAssignee(userId))) {
      throw new ConflictException(
        'El usuario no está activo o no posee permisos para revisar y validar documentos.',
      );
    }
  }

  private concurrentChange(): ConflictException {
    return new ConflictException(
      'La asignación cambió mientras trabajabas. Actualiza la cola e intenta nuevamente.',
    );
  }

  private toAssignmentResponse(document: ReviewQueueDocument): ReviewAssignmentResponseDto {
    return {
      documentId: document.id,
      reviewPriority: document.reviewPriority,
      version: document.version,
      assignedAt: document.assignedAt,
      assignee: document.assignedReviewer,
    };
  }
}
