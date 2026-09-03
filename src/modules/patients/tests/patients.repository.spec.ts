import { Prisma } from '@prisma/client';
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
