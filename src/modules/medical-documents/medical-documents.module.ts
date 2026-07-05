import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { MedicalDocumentsController } from './medical-documents.controller';
import { MedicalDocumentsService } from './medical-documents.service';
import { MedicalDocumentsRepository } from './repositories/medical-documents.repository';

@Module({
  imports: [NotificationsModule],
  controllers: [MedicalDocumentsController],
  providers: [MedicalDocumentsService, MedicalDocumentsRepository],
})
export class MedicalDocumentsModule {}
