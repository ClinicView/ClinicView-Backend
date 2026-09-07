import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RecordStatus } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { MedicalDocumentsRepository } from '../../medical-documents/repositories/medical-documents.repository';
import { FindRecordsQueryDto } from '../dto/find-records-query.dto';
import { ClinicalRecordsRepository } from '../repositories/clinical-records.repository';

describe('clinical pagination contract', () => {
  const findMany = jest.fn().mockResolvedValue([]);
  const count = jest.fn().mockResolvedValue(0);
  const prisma = {
    clinicalRecord: { findMany, count },
    medicalDocument: { findMany, count },
    $transaction: (queries: Promise<unknown>[]) => Promise.all(queries),
  } as unknown as PrismaService;
  beforeEach(() => jest.clearAllMocks());

  it('accepts an explicit ALL status without accepting arbitrary status values', async () => {
    expect(await validate(plainToInstance(FindRecordsQueryDto, { status: 'ALL' }))).toHaveLength(0);
    expect(
      await validate(plainToInstance(FindRecordsQueryDto, { status: 'INVALID' })),
    ).not.toHaveLength(0);
  });

  it('includes corrected and voided records only when ALL is requested', async () => {
    const repository = new ClinicalRecordsRepository(prisma);
    await repository.findByPatient('patient-id', { status: 'ALL', page: 2, limit: 50 });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { patientId: 'patient-id' },
        skip: 50,
        take: 50,
        orderBy: [{ attendedAt: 'desc' }, { id: 'desc' }],
      }),
    );
    expect(count).toHaveBeenCalledWith({ where: { patientId: 'patient-id' } });
    await repository.findByPatient('patient-id', { page: 1, limit: 50 });
    expect(findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { patientId: 'patient-id', status: RecordStatus.ACTIVE },
      }),
    );
  });

  it('keeps explicit status filters and stabilizes equal dates', async () => {
    await new ClinicalRecordsRepository(prisma).findByPatient('patient-id', {
      status: 'VOIDED',
      page: 1,
      limit: 20,
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { patientId: 'patient-id', status: RecordStatus.VOIDED },
      }),
    );
    await new MedicalDocumentsRepository(prisma).findByPatient('patient-id', {
      page: 2,
      limit: 50,
    });
    expect(findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { patientId: 'patient-id' },
        skip: 50,
        take: 50,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    );
  });
});
