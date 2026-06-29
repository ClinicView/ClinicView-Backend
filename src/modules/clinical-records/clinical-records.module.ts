import { Module } from '@nestjs/common';
import { ClinicalRecordsController } from './clinical-records.controller';
import { ClinicalRecordsService } from './clinical-records.service';
import { ClinicalRecordsRepository } from './repositories/clinical-records.repository';

@Module({
  controllers: [ClinicalRecordsController],
  providers: [ClinicalRecordsService, ClinicalRecordsRepository],
})
export class ClinicalRecordsModule {}
