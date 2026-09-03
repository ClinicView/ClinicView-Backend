import { ClinicalMediaStatus } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { ClinicalRecordMediaRepository } from '../repositories/clinical-record-media.repository';

describe('ClinicalRecordMediaRepository', () => {
  const clinicalMediaAsset = {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    updateMany: jest.fn(),
    deleteMany: jest.fn(),
    aggregate: jest.fn(),
  };
  const clinicalRecordAttachment = { createMany: jest.fn() };
  const patient = { findUnique: jest.fn() };
  const tx = { clinicalMediaAsset, clinicalRecordAttachment, patient } as never;
  const repository = new ClinicalRecordMediaRepository({} as PrismaService);

  beforeEach(() => jest.clearAllMocks());

  it('acota lecturas por asset y paciente para evitar IDOR', async () => {
    clinicalMediaAsset.findFirst.mockResolvedValue(null);
    await repository.findByIdAndPatient('asset-id', 'patient-id', tx);
    expect(clinicalMediaAsset.findFirst).toHaveBeenCalledWith({
      where: { id: 'asset-id', patientId: 'patient-id' },
    });
  });

  it('transiciona todos los temporales propios y vigentes en una sola operación', async () => {
    clinicalMediaAsset.updateMany.mockResolvedValue({ count: 2 });
    const now = new Date('2026-09-03T12:00:00Z');
    await expect(
      repository.transitionTemporaryToAttached(
        ['asset-a', 'asset-b'],
        'patient-id',
        'actor-id',
        now,
        tx,
      ),
    ).resolves.toBe(true);
    expect(clinicalMediaAsset.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['asset-a', 'asset-b'] },
        patientId: 'patient-id',
        uploadedBy: 'actor-id',
        status: ClinicalMediaStatus.TEMPORARY,
        expiresAt: { gt: now },
      },
      data: {
        status: ClinicalMediaStatus.ATTACHED,
        expiresAt: null,
        version: { increment: 1 },
      },
    });
  });

  it('calcula cuota solo sobre temporales propios no expirados', async () => {
    clinicalMediaAsset.aggregate.mockResolvedValue({
      _count: { _all: 3 },
      _sum: { sizeBytes: 4096 },
    });
    const now = new Date('2026-09-03T12:00:00Z');
    await expect(repository.getTemporaryQuota('patient-id', 'actor-id', now, tx)).resolves.toEqual({
      count: 3,
      sizeBytes: 4096,
    });
    expect(clinicalMediaAsset.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          patientId: 'patient-id',
          uploadedBy: 'actor-id',
          status: ClinicalMediaStatus.TEMPORARY,
          expiresAt: { gt: now },
        },
      }),
    );
  });

  it('renueva TTL sin cambiar versión y exige ownership/estado vigentes', async () => {
    clinicalMediaAsset.updateMany.mockResolvedValue({ count: 1 });
    const now = new Date('2026-09-03T12:00:00Z');
    const expiresAt = new Date('2026-09-10T12:00:00Z');
    await expect(
      repository.extendTemporaryExpiry(['asset-id'], 'patient-id', 'actor-id', now, expiresAt, tx),
    ).resolves.toBe(true);
    expect(clinicalMediaAsset.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['asset-id'] },
        patientId: 'patient-id',
        uploadedBy: 'actor-id',
        status: ClinicalMediaStatus.TEMPORARY,
        expiresAt: { gt: now },
      },
      data: { expiresAt },
    });
  });

  it('elimina por CAS únicamente metadata temporal del dueño/paciente', async () => {
    clinicalMediaAsset.deleteMany.mockResolvedValue({ count: 1 });
    const asset = {
      id: 'asset-id',
      patientId: 'patient-id',
      uploadedBy: 'actor-id',
      version: 4,
    };
    const expiredBefore = new Date('2026-09-03T12:00:00Z');
    await expect(repository.deleteTemporaryCas(asset, tx, expiredBefore)).resolves.toBe(true);
    expect(clinicalMediaAsset.deleteMany).toHaveBeenCalledWith({
      where: {
        ...asset,
        status: ClinicalMediaStatus.TEMPORARY,
        expiresAt: { lte: expiredBefore },
      },
    });
  });

  it('crea vínculos por lote sin escribir cuando la lista está vacía', async () => {
    await repository.createAttachments([], tx);
    expect(clinicalRecordAttachment.createMany).not.toHaveBeenCalled();

    clinicalRecordAttachment.createMany.mockResolvedValue({ count: 1 });
    const rows = [
      {
        clinicalRecordId: 'record-id',
        assetId: 'asset-id',
        sortOrder: 0,
        createdBy: 'actor-id',
      },
    ];
    await repository.createAttachments(rows, tx);
    expect(clinicalRecordAttachment.createMany).toHaveBeenCalledWith({ data: rows });
  });
});
