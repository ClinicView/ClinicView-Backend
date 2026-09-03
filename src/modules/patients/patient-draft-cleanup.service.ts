import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PatientsRepository } from './repositories/patients.repository';

@Injectable()
export class PatientDraftCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PatientDraftCleanupService.name);
  private cleanupTimer?: NodeJS.Timeout;

  constructor(
    private readonly patientsRepository: PatientsRepository,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.purgeExpiredDrafts();
    const minutes = this.configService.get<number>('patientDraft.cleanupIntervalMinutes', 60);
    this.cleanupTimer = setInterval(() => void this.purgeExpiredDrafts(), minutes * 60 * 1000);
    this.cleanupTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
  }

  private async purgeExpiredDrafts(): Promise<void> {
    try {
      const count = await this.patientsRepository.purgeExpiredRegistrationDrafts();
      if (count > 0) {
        this.logger.log(`Purged ${count} expired patient registration draft(s).`);
      }
    } catch (error) {
      this.logger.error(
        'Could not purge expired patient registration drafts.',
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}
