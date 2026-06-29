import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../core/rbac/permissions.guard';
import { RequirePermissions } from '../../core/rbac/requires-permissions.decorator';
import { ReviewService } from './review.service';
import { FindReviewQueueQueryDto } from './dto/find-review-queue-query.dto';
import { ReviewQueuePageDto } from './dto/review-queue-item.dto';

@ApiTags('review')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('review')
export class ReviewController {
  constructor(private readonly service: ReviewService) {}

  @Get('queue')
  @RequirePermissions('review.read')
  @ApiOperation({ summary: 'Cola de revisión — documentos procesados pendientes de validación clínica' })
  @ApiResponse({ status: 200, type: ReviewQueuePageDto })
  getQueue(@Query() query: FindReviewQueueQueryDto): Promise<ReviewQueuePageDto> {
    return this.service.getQueue(query);
  }
}
