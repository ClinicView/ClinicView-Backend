import { Injectable } from '@nestjs/common';
import { ReviewRepository } from './repositories/review.repository';
import { FindReviewQueueQueryDto } from './dto/find-review-queue-query.dto';
import { ReviewQueueItemDto, ReviewQueuePageDto } from './dto/review-queue-item.dto';

@Injectable()
export class ReviewService {
  constructor(private readonly repo: ReviewRepository) {}

  async getQueue(query: FindReviewQueueQueryDto): Promise<ReviewQueuePageDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { items, total } = await this.repo.findQueue({ page, limit });

    return {
      data: items.map((item): ReviewQueueItemDto => ({
        id: item.id,
        originalName: item.originalName,
        mimeType: item.mimeType,
        sizeBytes: item.sizeBytes,
        processedAt: item.processedAt,
        createdAt: item.createdAt,
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
}
