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

      const result = await controller.getQueue({ page: 1, limit: 20 });

      expect(mockReviewService.getQueue).toHaveBeenCalledWith({ page: 1, limit: 20 });
      expect(result).toEqual(mockQueuePage);
    });
  });
});
