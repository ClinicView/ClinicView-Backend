import { Test, TestingModule } from '@nestjs/testing';
import { DocumentStatus, DocumentType } from '@prisma/client';
import { ReviewService } from '../review.service';
import { ReviewRepository } from '../repositories/review.repository';

const makePatient = () => ({
  id: 'patient-uuid',
  firstName: 'María',
  lastName: 'García',
  documentType: DocumentType.DNI,
  documentNumber: '12345678',
});

const makeItem = (overrides: Record<string, unknown> = {}) => ({
  id: 'doc-uuid',
  originalName: 'informe.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 102400,
  status: DocumentStatus.PROCESSED,
  processedAt: new Date('2026-06-08T10:00:00Z'),
  createdAt: new Date('2026-06-08T09:00:00Z'),
  patient: makePatient(),
  ...overrides,
});

const mockRepo = {
  findQueue: jest.fn(),
} satisfies Record<keyof ReviewRepository, jest.Mock>;

describe('ReviewService', () => {
  let service: ReviewService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReviewService,
        { provide: ReviewRepository, useValue: mockRepo },
      ],
    }).compile();

    service = module.get(ReviewService);
    jest.clearAllMocks();
  });

  describe('getQueue', () => {
    it('devuelve la cola paginada con datos del paciente', async () => {
      mockRepo.findQueue.mockResolvedValue({ items: [makeItem()], total: 1 });

      const result = await service.getQueue({ page: 1, limit: 20 });

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

      await service.getQueue({});

      expect(mockRepo.findQueue).toHaveBeenCalledWith({ page: 1, limit: 20 });
    });

    it('devuelve lista vacía cuando no hay documentos pendientes', async () => {
      mockRepo.findQueue.mockResolvedValue({ items: [], total: 0 });

      const result = await service.getQueue({ page: 1, limit: 20 });

      expect(result.data).toHaveLength(0);
      expect(result.total).toBe(0);
    });
  });
});
