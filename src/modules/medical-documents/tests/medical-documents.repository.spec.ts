import { DocumentStatus, MedicalDocument, Prisma } from '@prisma/client';
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
      'reviewer-uuid',
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
        assignedReviewerId: 'reviewer-uuid',
        version: 4,
      },
      data: expect.objectContaining({
        correctedText: 'Texto final',
        status: DocumentStatus.VALIDATED,
        validationAttested: true,
        version: { increment: 1 },
      }),
    });
    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'doc-uuid' } }));
    expect(result).toBe(validated);
  });

  it('no lee ni modifica una segunda vez cuando pierde el compare-and-swap', async () => {
    updateMany.mockResolvedValue({ count: 0 });

    const result = await repository.validateWithCorrection(
      'doc-uuid',
      'patient-uuid',
      4,
      'reviewer-uuid',
      {
        correctedText: 'Texto final',
        correctedEntities: [],
        correctedAt: new Date(),
        reviewedAt: new Date(),
        reviewedBy: 'reviewer-uuid',
        validationChecklist: ['text', 'entities', 'sections', 'phi'],
        validationAttestedAt: new Date(),
        updatedBy: 'reviewer-uuid',
      },
    );

    expect(result).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('rechaza solo la versión revisada y limpia cualquier atestación previa', async () => {
    const rejected = { id: 'doc-uuid', status: DocumentStatus.REJECTED } as MedicalDocument;
    updateMany.mockResolvedValue({ count: 1 });
    findUnique.mockResolvedValue(rejected);

    const result = await repository.rejectReviewedVersion(
      'doc-uuid',
      'patient-uuid',
      4,
      'reviewer-uuid',
      {
        rejectReason: 'Documento ilegible por baja resolución.',
        reviewedAt: new Date('2026-09-02T10:00:00.000Z'),
        reviewedBy: 'reviewer-uuid',
        updatedBy: 'reviewer-uuid',
      },
    );

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'doc-uuid',
        patientId: 'patient-uuid',
        OR: [
          { status: DocumentStatus.PENDING },
          { status: DocumentStatus.PROCESSED, assignedReviewerId: 'reviewer-uuid' },
        ],
        version: 4,
      },
      data: expect.objectContaining({
        status: DocumentStatus.REJECTED,
        validationChecklist: Prisma.DbNull,
        validationAttested: false,
        validationAttestedAt: null,
        version: { increment: 1 },
      }),
    });
    expect(result).toBe(rejected);
  });

  it('permite que solo una operación gane entre validar y rechazar la misma versión', async () => {
    const row: Record<string, unknown> = {
      id: 'doc-uuid',
      patientId: 'patient-uuid',
      status: DocumentStatus.PROCESSED,
      assignedReviewerId: 'reviewer-uuid',
      version: 4,
      validationChecklist: null,
      validationAttested: false,
      validationAttestedAt: null,
    };

    updateMany.mockImplementation(async ({ where, data }) => {
      await Promise.resolve();
      const statusMatches = where.status
        ? row.status === where.status
        : where.OR.some((branch: Record<string, unknown>) =>
            row.status === branch.status &&
            (!branch.assignedReviewerId || row.assignedReviewerId === branch.assignedReviewerId),
          );
      if (
        row.id !== where.id ||
        row.patientId !== where.patientId ||
        row.version !== where.version ||
        !statusMatches
      ) {
        return { count: 0 };
      }

      const { version, validationChecklist, ...changes } = data;
      Object.assign(row, changes, {
        validationChecklist:
          validationChecklist === Prisma.DbNull ? null : validationChecklist,
        version: (row.version as number) + version.increment,
      });
      return { count: 1 };
    });
    findUnique.mockImplementation(async () => row as unknown as MedicalDocument);

    const [validationResult, rejectionResult] = await Promise.all([
      repository.validateWithCorrection('doc-uuid', 'patient-uuid', 4, 'reviewer-uuid', {
        correctedText: 'Texto final',
        correctedEntities: [],
        reviewedAt: new Date('2026-09-02T10:00:00.000Z'),
        reviewedBy: 'validator-uuid',
        validationChecklist: {
          schemaVersion: 1,
          locale: 'es-PE',
          items: [],
        },
        validationAttestedAt: new Date('2026-09-02T10:00:00.000Z'),
        updatedBy: 'validator-uuid',
      }),
      repository.rejectReviewedVersion('doc-uuid', 'patient-uuid', 4, 'reviewer-uuid', {
        rejectReason: 'Documento ilegible por baja resolución.',
        reviewedAt: new Date('2026-09-02T10:00:00.000Z'),
        reviewedBy: 'rejector-uuid',
        updatedBy: 'rejector-uuid',
      }),
    ]);

    expect([validationResult, rejectionResult].filter(Boolean)).toHaveLength(1);
    expect(row.version).toBe(5);
    expect([DocumentStatus.VALIDATED, DocumentStatus.REJECTED]).toContain(row.status);
    if (row.status === DocumentStatus.VALIDATED) {
      expect(row.validationAttested).toBe(true);
    } else {
      expect(row.validationAttested).toBe(false);
      expect(row.validationChecklist).toBeNull();
    }
  });
});
