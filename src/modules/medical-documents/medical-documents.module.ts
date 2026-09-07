import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { MedicalDocumentsController } from './medical-documents.controller';
import { MedicalDocumentsService } from './medical-documents.service';
import { MedicalDocumentsRepository } from './repositories/medical-documents.repository';
import { DocumentMetadataController } from './document-metadata.controller';
import { DocumentMetadataService } from './document-metadata.service';

@Module({
  imports: [NotificationsModule],
  controllers: [MedicalDocumentsController, DocumentMetadataController],
  providers: [MedicalDocumentsService, MedicalDocumentsRepository, DocumentMetadataService],
})
export class MedicalDocumentsModule {}
