import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { PatientsRepository } from '../repositories/patients.repository';

describe('PatientsRepository export snapshot', () => {
  it('lee la historia dentro de una transacción repeatable-read', async () => {
    const findUnique = jest.fn().mockResolvedValue(null);
    const transactionClient = { patient: { findUnique } };
    const transaction = jest.fn(
      async (
        callback: (client: typeof transactionClient) => Promise<unknown>,
      ) => callback(transactionClient),
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
  });
});
