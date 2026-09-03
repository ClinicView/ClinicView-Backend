import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { PatientDraftCleanupService } from '../patient-draft-cleanup.service';
import { PatientsRepository } from '../repositories/patients.repository';

describe('PatientDraftCleanupService', () => {
  afterEach(() => jest.useRealTimers());

  it('purga al iniciar, repite con el intervalo configurado y detiene el timer', async () => {
    jest.useFakeTimers();
    const purge = jest.fn().mockResolvedValue(0);
    const service = new PatientDraftCleanupService(
      { purgeExpiredRegistrationDrafts: purge } as unknown as PatientsRepository,
      { get: jest.fn().mockReturnValue(5) } as unknown as ConfigService,
    );

    await service.onModuleInit();
    expect(purge).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(purge).toHaveBeenCalledTimes(2);

    service.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(purge).toHaveBeenCalledTimes(2);
  });

  it('no interrumpe el arranque si la purga falla', async () => {
    const errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const service = new PatientDraftCleanupService(
      {
        purgeExpiredRegistrationDrafts: jest.fn().mockRejectedValue(new Error('db unavailable')),
      } as unknown as PatientsRepository,
      { get: jest.fn().mockReturnValue(60) } as unknown as ConfigService,
    );

    await expect(service.onModuleInit()).resolves.toBeUndefined();
    expect(errorLog).toHaveBeenCalled();
    service.onModuleDestroy();
    errorLog.mockRestore();
  });
});
