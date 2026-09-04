import { Test, TestingModule } from '@nestjs/testing';
import { ReviewController } from '../review.controller';
import { ReviewService } from '../review.service';

const mockQueuePage = {
  data: [],
  total: 0,
  page: 1,
  limit: 20,
};

const mockReviewService = {
  getQueue: jest.fn(),
  listAssignees: jest.fn(),
  claim: jest.fn(),
  assign: jest.fn(),
  release: jest.fn(),
  updatePriority: jest.fn(),
};

const request = {
  user: { sub: 'actor-uuid', permissions: ['review.read', 'review.assign'] },
};

describe('ReviewController', () => {
  let controller: ReviewController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReviewController],
      providers: [{ provide: ReviewService, useValue: mockReviewService }],
    }).compile();

    controller = module.get(ReviewController);
    jest.clearAllMocks();
  });

  describe('getQueue', () => {
    it('delega en ReviewService.getQueue y devuelve el resultado', async () => {
      mockReviewService.getQueue.mockResolvedValue(mockQueuePage);

      const result = await controller.getQueue({ page: 1, limit: 20 }, request);

      expect(mockReviewService.getQueue).toHaveBeenCalledWith(
        { page: 1, limit: 20 },
        'actor-uuid',
      );
      expect(result).toEqual(mockQueuePage);
    });
  });

  it('delega la búsqueda de revisores sin exponer lógica en el controlador', async () => {
    mockReviewService.listAssignees.mockResolvedValue({ data: [] });

    await expect(controller.listAssignees({ q: 'maria' })).resolves.toEqual({ data: [] });
    expect(mockReviewService.listAssignees).toHaveBeenCalledWith('maria');
  });

  it('toma un documento usando actor y versión observada', async () => {
    mockReviewService.claim.mockResolvedValue({ documentId: 'document-uuid', version: 3 });

    await controller.claim('document-uuid', { expectedVersion: 2 }, request);

    expect(mockReviewService.claim).toHaveBeenCalledWith(
      'document-uuid',
      2,
      'actor-uuid',
    );
  });

  it('delega asignación, liberación y prioridad con el actor autenticado', async () => {
    const assignment = { assigneeId: 'reviewer-uuid', expectedVersion: 1 };
    const release = { expectedVersion: 2 };
    const priority = { priority: 'HIGH' as const, expectedVersion: 3 };

    await controller.assign('document-uuid', assignment, request);
    await controller.release('document-uuid', release, request);
    await controller.updatePriority('document-uuid', priority, request);

    expect(mockReviewService.assign).toHaveBeenCalledWith(
      'document-uuid',
      assignment,
      'actor-uuid',
    );
    expect(mockReviewService.release).toHaveBeenCalledWith(
      'document-uuid',
      2,
      'actor-uuid',
    );
    expect(mockReviewService.updatePriority).toHaveBeenCalledWith(
      'document-uuid',
      priority,
      'actor-uuid',
    );
  });
});
