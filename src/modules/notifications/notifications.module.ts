import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { ClinicalWorkController, ClinicalWorkService } from './clinical-work';

@Module({
  controllers: [NotificationsController, ClinicalWorkController],
  providers: [NotificationsService, ClinicalWorkService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
