import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { DocumentStatus, DocumentType, ReviewPriority } from '@prisma/client';
import { ReviewService } from '../review.service';
import { ReviewRepository } from '../repositories/review.repository';
import { NotificationsService } from '../../notifications/notifications.service';

const makePatient = () => ({
  id: 'patient-uuid',
  firstName: 'María',
  lastName: 'García',
  documentType: DocumentType.DNI,
  documentNumber: '12345678',
});

const makeItem = (overrides: Record<string, unknown> = {}) => ({
  id: 'doc-uuid',
  patientId: 'patient-uuid',
  originalName: 'informe.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 102400,
  status: DocumentStatus.PROCESSED,
  processedAt: new Date('2026-06-08T10:00:00Z'),
  createdAt: new Date('2026-06-08T09:00:00Z'),
  reviewPriority: ReviewPriority.NORMAL,
  version: 0,
  assignedReviewerId: null,
  assignedAt: null,
  assignedReviewer: null,
  patient: makePatient(),
  ...overrides,
});

const mockRepo = {
  findQueue: jest.fn(),
  findEligibleAssignees: jest.fn(),
  isEligibleAssignee: jest.fn(),
  findDocument: jest.fn(),
  claim: jest.fn(),
  assign: jest.fn(),
  release: jest.fn(),
  updatePriority: jest.fn(),
} satisfies Record<keyof ReviewRepository, jest.Mock>;

const notifications = { notify: jest.fn() };

describe('ReviewService', () => {
  let service: ReviewService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReviewService,
        { provide: ReviewRepository, useValue: mockRepo },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();

    service = module.get(ReviewService);
    jest.clearAllMocks();
  });

  describe('getQueue', () => {
    it('devuelve la cola paginada con datos del paciente', async () => {
      mockRepo.findQueue.mockResolvedValue({ items: [makeItem()], total: 1 });

      const result = await service.getQueue({ page: 1, limit: 20 }, 'actor-uuid');

      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe('doc-uuid');
      expect(result.data[0].patient.id).toBe('patient-uuid');
      expect(result.data[0].patient.firstName).toBe('María');
    });

    it('usa valores por defecto si no se pasa paginación', async () => {
      mockRepo.findQueue.mockResolvedValue({ items: [], total: 0 });

      await service.getQueue({}, 'actor-uuid');

      expect(mockRepo.findQueue).toHaveBeenCalledWith({
        page: 1,
        limit: 20,
        actorId: 'actor-uuid',
        scope: 'AVAILABLE',
      });
    });

    it('devuelve lista vacía cuando no hay documentos pendientes', async () => {
      mockRepo.findQueue.mockResolvedValue({ items: [], total: 0 });

      const result = await service.getQueue({ page: 1, limit: 20 }, 'actor-uuid');

      expect(result.data).toHaveLength(0);
      expect(result.total).toBe(0);
    });
  });

  describe('assignment', () => {
    it('toma atomicamente un documento sin asignar', async () => {
      const current = makeItem();
      const claimed = makeItem({
        version: 1,
        assignedReviewerId: 'actor-uuid',
        assignedAt: new Date(),
        assignedReviewer: {
          id: 'actor-uuid',
          username: 'medico',
          fullName: 'Medico Revisor',
          profession: 'Medicina',
        },
      });
      mockRepo.isEligibleAssignee.mockResolvedValue(true);
      mockRepo.findDocument.mockResolvedValue(current);
      mockRepo.claim.mockResolvedValue(claimed);

      const result = await service.claim('doc-uuid', 0, 'actor-uuid');

      expect(mockRepo.claim).toHaveBeenCalledWith('doc-uuid', 'actor-uuid', 0);
      expect(result.assignee?.id).toBe('actor-uuid');
      expect(result.version).toBe(1);
    });

    it('rechaza tomar un documento ya asignado', async () => {
      mockRepo.isEligibleAssignee.mockResolvedValue(true);
      mockRepo.findDocument.mockResolvedValue(
        makeItem({ assignedReviewerId: 'other-uuid' }),
      );

      await expect(service.claim('doc-uuid', 0, 'actor-uuid')).rejects.toThrow(
        ConflictException,
      );
      expect(mockRepo.claim).not.toHaveBeenCalled();
    });

    it('valida al destinatario y notifica una asignacion a otra persona', async () => {
      const assigned = makeItem({
        version: 1,
        assignedReviewerId: 'reviewer-uuid',
        assignedAt: new Date(),
        assignedReviewer: {
          id: 'reviewer-uuid',
          username: 'reviewer',
          fullName: 'Revisor Clinico',
          profession: null,
        },
      });
      mockRepo.isEligibleAssignee.mockResolvedValue(true);
      mockRepo.findDocument.mockResolvedValue(makeItem());
      mockRepo.assign.mockResolvedValue(assigned);

      await service.assign(
        'doc-uuid',
        { assigneeId: 'reviewer-uuid', expectedVersion: 0 },
        'admin-uuid',
      );

      expect(mockRepo.assign).toHaveBeenCalledWith(
        'doc-uuid',
        'reviewer-uuid',
        0,
        'admin-uuid',
      );
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'reviewer-uuid',
          type: 'DOCUMENT_REVIEW_ASSIGNED',
        }),
      );
    });

    it('informa conflicto cuando pierde el compare-and-swap al liberar', async () => {
      mockRepo.findDocument.mockResolvedValue(
        makeItem({ assignedReviewerId: 'actor-uuid', version: 2 }),
      );
      mockRepo.release.mockResolvedValue(null);

      await expect(service.release('doc-uuid', 1, 'actor-uuid')).rejects.toThrow(
        'La asignación cambió',
      );
    });

    it('mantiene la asignacion confirmada si falla la notificacion secundaria', async () => {
      const assigned = makeItem({
        version: 1,
        assignedReviewerId: 'reviewer-uuid',
        assignedAt: new Date(),
        assignedReviewer: {
          id: 'reviewer-uuid',
          username: 'reviewer',
          fullName: 'Revisor Clinico',
          profession: null,
        },
      });
      mockRepo.isEligibleAssignee.mockResolvedValue(true);
      mockRepo.findDocument.mockResolvedValue(makeItem());
      mockRepo.assign.mockResolvedValue(assigned);
      notifications.notify.mockRejectedValueOnce(new Error('notification unavailable'));

      await expect(service.assign(
        'doc-uuid',
        { assigneeId: 'reviewer-uuid', expectedVersion: 0 },
        'admin-uuid',
      )).resolves.toEqual(expect.objectContaining({ version: 1 }));
    });
  });
});
