import { Module } from '@nestjs/common';
import { PatientsRepository } from './repositories/patients.repository';
import { PatientsController } from './patients.controller';
import { PatientsService } from './patients.service';
import { PatientDraftCleanupService } from './patient-draft-cleanup.service';

@Module({
  controllers: [PatientsController],
  providers: [PatientsService, PatientsRepository, PatientDraftCleanupService],
  exports: [PatientsService],
})
export class PatientsModule {}
