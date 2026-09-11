import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { MedicalDocumentsController } from './medical-documents.controller';
import { MedicalDocumentsService } from './medical-documents.service';
import { MedicalDocumentsRepository } from './repositories/medical-documents.repository';
import { DocumentMetadataController } from './document-metadata.controller';
import { DocumentMetadataService } from './document-metadata.service';
import { OcrLayoutService } from './ocr-layout.service';
import { OcrLayoutController } from './ocr-layout.controller';

@Module({
  imports: [NotificationsModule],
  controllers: [MedicalDocumentsController, DocumentMetadataController, OcrLayoutController],
  providers: [
    MedicalDocumentsService,
    MedicalDocumentsRepository,
    DocumentMetadataService,
    OcrLayoutService,
  ],
})
export class MedicalDocumentsModule {}
