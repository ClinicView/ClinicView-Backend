import { DocumentStatus, MedicalDocument } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { MedicalDocumentsRepository } from '../repositories/medical-documents.repository';

describe('MedicalDocumentsRepository', () => {
  const updateMany = jest.fn();
  const findUnique = jest.fn();
  const transactionClient = {
    medicalDocument: { updateMany, findUnique },
  };
  const prisma = {
    $transaction: jest.fn(
      async (callback: (client: typeof transactionClient) => Promise<unknown>) =>
        callback(transactionClient),
    ),
  } as unknown as PrismaService;
  const repository = new MedicalDocumentsRepository(prisma);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('compara versión y estado antes de guardar y validar en la misma transacción', async () => {
    const validated = { id: 'doc-uuid', status: DocumentStatus.VALIDATED } as MedicalDocument;
    updateMany.mockResolvedValue({ count: 1 });
    findUnique.mockResolvedValue(validated);

    const result = await repository.validateWithCorrection(
      'doc-uuid',
      'patient-uuid',
      4,
      {
        correctedText: 'Texto final',
        correctedEntities: [],
        correctedAt: new Date('2026-09-02T10:00:00.000Z'),
        reviewedAt: new Date('2026-09-02T10:00:00.000Z'),
        validationChecklist: ['text', 'entities', 'sections', 'phi'],
        validationAttestedAt: new Date('2026-09-02T10:00:00.000Z'),
        correctedById: 'user-uuid',
        reviewedBy: 'user-uuid',
        updatedBy: 'user-uuid',
      },
    );

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'doc-uuid',
        patientId: 'patient-uuid',
        status: DocumentStatus.PROCESSED,
        version: 4,
      },
      data: expect.objectContaining({
        correctedText: 'Texto final',
        status: DocumentStatus.VALIDATED,
        validationAttested: true,
        version: { increment: 1 },
      }),
    });
    expect(findUnique).toHaveBeenCalledWith({ where: { id: 'doc-uuid' } });
    expect(result).toBe(validated);
  });

  it('no lee ni modifica una segunda vez cuando pierde el compare-and-swap', async () => {
    updateMany.mockResolvedValue({ count: 0 });

    const result = await repository.validateWithCorrection(
      'doc-uuid',
      'patient-uuid',
      4,
      {
        correctedText: 'Texto final',
        correctedEntities: [],
        correctedAt: new Date(),
        reviewedAt: new Date(),
        validationChecklist: ['text', 'entities', 'sections', 'phi'],
        validationAttestedAt: new Date(),
      },
    );

    expect(result).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });
});
