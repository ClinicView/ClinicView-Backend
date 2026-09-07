import { Module } from '@nestjs/common';
import { PatientsRepository } from './repositories/patients.repository';
import { PatientsController } from './patients.controller';
import { PatientsService } from './patients.service';
import { PatientDraftCleanupService } from './patient-draft-cleanup.service';
import { ClinicalSummaryController } from './clinical-summary.controller';
import { ClinicalSummaryService } from './clinical-summary.service';
import { ClinicalHistoryController } from './clinical-history.controller';
import { ClinicalHistoryService } from './clinical-history.service';

@Module({
  controllers: [PatientsController, ClinicalSummaryController, ClinicalHistoryController],
  providers: [
    PatientsService,
    PatientsRepository,
    PatientDraftCleanupService,
    ClinicalSummaryService,
    ClinicalHistoryService,
  ],
  exports: [PatientsService],
})
export class PatientsModule {}
