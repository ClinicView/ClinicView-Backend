import { RecordStatus } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { ClinicalRecordsRepository } from '../repositories/clinical-records.repository';

describe('ClinicalRecordsRepository optimistic concurrency', () => {
  const clinicalRecord = {
    updateMany: jest.fn(),
    findUnique: jest.fn(),
  };
  const clinicalRecordDraft = {
    updateMany: jest.fn(),
    findUnique: jest.fn(),
    deleteMany: jest.fn(),
  };
  const tx = { clinicalRecord, clinicalRecordDraft } as never;
  const repository = new ClinicalRecordsRepository({} as PrismaService);

  beforeEach(() => jest.clearAllMocks());

  it('marca una corrección solo si paciente, estado y versión coinciden', async () => {
    clinicalRecord.updateMany.mockResolvedValue({ count: 1 });
    await expect(
      repository.markCorrected('record-id', 'patient-id', 4, 'actor-id', tx),
    ).resolves.toBe(true);
    expect(clinicalRecord.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'record-id',
        patientId: 'patient-id',
        status: RecordStatus.ACTIVE,
        version: 4,
      },
      data: {
        status: RecordStatus.CORRECTED,
        updatedBy: 'actor-id',
        version: { increment: 1 },
      },
    });
  });

  it('informa la pérdida de carrera al anular', async () => {
    clinicalRecord.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      repository.markVoided(
        'record-id',
        'patient-id',
        2,
        'Duplicado por error de captura.',
        'actor-id',
        tx,
      ),
    ).resolves.toBe(false);
    expect(clinicalRecord.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ version: 2, status: RecordStatus.ACTIVE }),
      }),
    );
  });

  it('actualiza un borrador mediante CAS e incrementa su versión', async () => {
    clinicalRecordDraft.updateMany.mockResolvedValue({ count: 1 });
    clinicalRecordDraft.findUnique.mockResolvedValue({ id: 'draft-id', version: 5 });
    const expiresAt = new Date('2026-09-10T12:00:00Z');
    const payload = { summary: 'Evolución favorable.' };

    await expect(
      repository.updateDraftCas('draft-id', 'actor-id', 4, payload, expiresAt, tx),
    ).resolves.toEqual({ id: 'draft-id', version: 5 });
    expect(clinicalRecordDraft.updateMany).toHaveBeenCalledWith({
      where: { id: 'draft-id', actorId: 'actor-id', version: 4 },
      data: { payload, expiresAt, version: { increment: 1 } },
    });
  });

  it('no lee el borrador tras un CAS fallido', async () => {
    clinicalRecordDraft.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      repository.updateDraftCas('draft-id', 'actor-id', 1, {}, new Date(), tx),
    ).resolves.toBeNull();
    expect(clinicalRecordDraft.findUnique).not.toHaveBeenCalled();
  });

  it('elimina un borrador solo con actor y versión coincidentes', async () => {
    clinicalRecordDraft.deleteMany.mockResolvedValue({ count: 1 });
    await expect(repository.deleteDraftCas('draft-id', 'actor-id', 7, tx)).resolves.toBe(true);
    expect(clinicalRecordDraft.deleteMany).toHaveBeenCalledWith({
      where: { id: 'draft-id', actorId: 'actor-id', version: 7 },
    });
  });
});
