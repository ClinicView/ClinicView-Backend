import { Module } from '@nestjs/common';
import { ReviewController } from './review.controller';
import { ReviewService } from './review.service';
import { ReviewRepository } from './repositories/review.repository';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [ReviewController],
  providers: [ReviewService, ReviewRepository],
})
export class ReviewModule {}
