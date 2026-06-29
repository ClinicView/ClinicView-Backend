import { Module } from '@nestjs/common';
import { MedicalDocumentsController } from './medical-documents.controller';
import { MedicalDocumentsService } from './medical-documents.service';
import { MedicalDocumentsRepository } from './repositories/medical-documents.repository';

@Module({
  controllers: [MedicalDocumentsController],
  providers: [MedicalDocumentsService, MedicalDocumentsRepository],
})
export class MedicalDocumentsModule {}
