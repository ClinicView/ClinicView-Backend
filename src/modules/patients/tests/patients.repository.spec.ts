import { DocumentType, Prisma, Sex } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { PatientsRepository } from '../repositories/patients.repository';

describe('PatientsRepository export snapshot', () => {
  it('lee la historia dentro de una transacción repeatable-read', async () => {
    const findUnique = jest.fn().mockResolvedValue(null);
    const transactionClient = { patient: { findUnique } };
    const transaction = jest.fn(
      async (callback: (client: typeof transactionClient) => Promise<unknown>) =>
        callback(transactionClient),
    );
    const repository = new PatientsRepository({
      $transaction: transaction,
    } as unknown as PrismaService);

    await repository.findClinicalHistoryForExport('patient-uuid');

    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'patient-uuid' } }),
    );

    const query = findUnique.mock.calls[0]?.[0];
    expect(query).toEqual(
      expect.objectContaining({
        select: expect.objectContaining({
          clinicalRecords: expect.objectContaining({
            orderBy: [{ attendedAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
            select: expect.objectContaining({
              details: true,
              schemaVersion: true,
              version: true,
              professionalId: true,
              professionalNameSnapshot: true,
              professionalLicenseSnapshot: true,
              attachments: expect.objectContaining({
                orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
                select: expect.objectContaining({
                  asset: expect.objectContaining({
                    select: expect.objectContaining({
                      patientId: true,
                      sha256: true,
                      status: true,
                    }),
                  }),
                }),
              }),
            }),
          }),
        }),
      }),
    );
    expect(JSON.stringify(query)).not.toContain('storagePath');
    expect(JSON.stringify(query)).not.toContain('uploadedBy');
  });
});

describe('PatientsRepository registration drafts', () => {
  const draft = {
    id: '93d89f74-3d39-4ed8-b050-8efab881d16b',
    actorId: '5b473f30-b3af-4799-a777-a031f3765bc5',
    payload: { firstName: 'María' },
    version: 2,
    expiresAt: new Date('2099-09-10T12:00:00.000Z'),
    createdAt: new Date('2026-09-03T12:00:00.000Z'),
    updatedAt: new Date('2026-09-03T12:05:00.000Z'),
  };
  const patientData = {
    documentType: DocumentType.DNI,
    documentNumber: '87654321',
    firstName: 'María',
    lastName: 'García',
    dateOfBirth: new Date('1985-06-15'),
    sex: Sex.F,
    createdBy: draft.actorId,
  };

  function repositoryWithTransaction(transactionClient: object) {
    const transaction = jest.fn(
      async (callback: (client: typeof transactionClient) => Promise<unknown>) =>
        callback(transactionClient),
    );
    return {
      repository: new PatientsRepository({
        $transaction: transaction,
      } as unknown as PrismaService),
      transaction,
    };
  }

  it('consume el borrador antes de crear al paciente dentro de una transacción serializable', async () => {
    const deleteMany = jest.fn().mockResolvedValue({ count: 1 });
    const createPatient = jest.fn().mockResolvedValue({ id: 'patient-id' });
    const { repository, transaction } = repositoryWithTransaction({
      patientRegistrationDraft: { deleteMany },
      patient: { create: createPatient },
    });

    const result = await repository.create(patientData, {
      id: draft.id,
      actorId: draft.actorId,
      version: draft.version,
    });

    expect(result).toEqual({ id: 'patient-id' });
    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        id: draft.id,
        actorId: draft.actorId,
        version: draft.version,
        expiresAt: { gt: expect.any(Date) },
      },
    });
    expect(createPatient).toHaveBeenCalledWith({ data: patientData });
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  });

  it('no crea al paciente cuando el borrador cambió o expiró', async () => {
    const createPatient = jest.fn();
    const { repository } = repositoryWithTransaction({
      patientRegistrationDraft: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      patient: { create: createPatient },
    });

    const result = await repository.create(patientData, {
      id: draft.id,
      actorId: draft.actorId,
      version: draft.version,
    });

    expect(result).toBeNull();
    expect(createPatient).not.toHaveBeenCalled();
  });

  it('crea el primer borrador solo si no llega una identidad antigua', async () => {
    const create = jest.fn().mockResolvedValue({ ...draft, version: 0 });
    const { repository } = repositoryWithTransaction({
      patientRegistrationDraft: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn().mockResolvedValue(null),
        create,
      },
    });

    const result = await repository.upsertRegistrationDraft({
      actorId: draft.actorId,
      payload: { firstName: 'María' },
      expiresAt: draft.expiresAt,
    });

    expect(result).toEqual({ ...draft, version: 0 });
    expect(create).toHaveBeenCalledWith({
      data: {
        actorId: draft.actorId,
        payload: { firstName: 'María' },
        expiresAt: draft.expiresAt,
      },
    });
  });

  it('actualiza con CAS de ID, actor y versión', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const findUnique = jest
      .fn()
      .mockResolvedValueOnce(draft)
      .mockResolvedValueOnce({ ...draft, version: 3 });
    const { repository } = repositoryWithTransaction({
      patientRegistrationDraft: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique,
        updateMany,
        create: jest.fn(),
      },
    });

    const result = await repository.upsertRegistrationDraft({
      actorId: draft.actorId,
      expectedId: draft.id,
      expectedVersion: 2,
      payload: { firstName: 'Ana' },
      expiresAt: draft.expiresAt,
    });

    expect(result?.version).toBe(3);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: draft.id,
          actorId: draft.actorId,
          version: 2,
          expiresAt: { gt: expect.any(Date) },
        }),
        data: expect.objectContaining({ version: { increment: 1 } }),
      }),
    );
  });

  it('rechaza ABA aunque la versión coincida con la de un borrador recreado', async () => {
    const updateMany = jest.fn();
    const { repository } = repositoryWithTransaction({
      patientRegistrationDraft: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn().mockResolvedValue({ ...draft, id: 'new-draft-id', version: 2 }),
        updateMany,
        create: jest.fn(),
      },
    });

    const result = await repository.upsertRegistrationDraft({
      actorId: draft.actorId,
      expectedId: draft.id,
      expectedVersion: 2,
      payload: {},
      expiresAt: draft.expiresAt,
    });

    expect(result).toBeNull();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('no elimina un borrador recreado con otra identidad', async () => {
    const deleteMany = jest
      .fn()
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 0 });
    const { repository } = repositoryWithTransaction({
      patientRegistrationDraft: {
        deleteMany,
        findUnique: jest.fn().mockResolvedValue({ id: 'new-draft-id' }),
      },
    });

    const result = await repository.deleteRegistrationDraft({
      id: draft.id,
      actorId: draft.actorId,
      version: draft.version,
    });

    expect(result).toBe(false);
    expect(deleteMany).toHaveBeenNthCalledWith(2, {
      where: { id: draft.id, actorId: draft.actorId, version: draft.version },
    });
  });

  it('consulta el borrador únicamente por actor', async () => {
    const findUnique = jest.fn().mockResolvedValue(draft);
    const repository = new PatientsRepository({
      patientRegistrationDraft: { findUnique },
    } as unknown as PrismaService);

    await repository.findRegistrationDraftByActor(draft.actorId);

    expect(findUnique).toHaveBeenCalledWith({ where: { actorId: draft.actorId } });
  });
});
