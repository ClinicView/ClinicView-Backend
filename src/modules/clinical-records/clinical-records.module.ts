import { Module } from '@nestjs/common';
import { ClinicalRecordMediaController } from './clinical-record-media.controller';
import { ClinicalRecordMediaService } from './clinical-record-media.service';
import { ClinicalRecordsController } from './clinical-records.controller';
import { ClinicalRecordsService } from './clinical-records.service';
import { ClinicalRecordMediaRepository } from './repositories/clinical-record-media.repository';
import { ClinicalRecordsRepository } from './repositories/clinical-records.repository';

@Module({
  controllers: [ClinicalRecordsController, ClinicalRecordMediaController],
  providers: [
    ClinicalRecordsService,
    ClinicalRecordsRepository,
    ClinicalRecordMediaService,
    ClinicalRecordMediaRepository,
  ],
})
export class ClinicalRecordsModule {}
