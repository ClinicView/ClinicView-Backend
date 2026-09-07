import { Module } from '@nestjs/common';
import { ClinicalEpisodesController } from './clinical-episodes.controller';
import { ClinicalEpisodesService } from './clinical-episodes.service';
@Module({ controllers: [ClinicalEpisodesController], providers: [ClinicalEpisodesService] })
export class ClinicalEpisodesModule {}
