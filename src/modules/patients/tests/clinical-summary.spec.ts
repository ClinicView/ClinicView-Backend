import { BadRequestException, ConflictException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PrismaService } from '../../../database/prisma.service';
import { ClinicalSummaryService, normalizeClinicalSummary } from '../clinical-summary.service';
import {
  EMPTY_CLINICAL_SUMMARY,
  SaveClinicalSummaryDto,
  ReconciliationStatus,
  AllergySeverity,
} from '../dto/clinical-summary.dto';
import { UpdatePatientDto } from '../dto/update-patient.dto';

const dto = (): SaveClinicalSummaryDto => ({
  ...EMPTY_CLINICAL_SUMMARY,
  expectedVersion: 0,
  reason: 'Revisado con el paciente de prueba.',
});
const allergy = {
  id: '922eae16-c6c7-4c40-82d6-7a6d8edb712a',
  name: 'Sustancia de prueba',
  reaction: 'Reacción de prueba',
  severity: AllergySeverity.UNKNOWN,
};

describe('Reconciliación longitudinal', () => {
  it('no infiere ausencia a partir de datos desconocidos', () => {
    expect(normalizeClinicalSummary(dto()).allergyStatus).toBe('UNKNOWN');
    expect(
      normalizeClinicalSummary({ ...dto(), allergyStatus: ReconciliationStatus.NONE_KNOWN })
        .allergies,
    ).toEqual([]);
  });
  it('rechaza estados contradictorios y nombres vacíos', () => {
    expect(() =>
      normalizeClinicalSummary({ ...dto(), allergyStatus: ReconciliationStatus.RECORDED }),
    ).toThrow(BadRequestException);
    expect(() => normalizeClinicalSummary({ ...dto(), allergies: [allergy] })).toThrow(
      BadRequestException,
    );
    expect(() =>
      normalizeClinicalSummary({
        ...dto(),
        allergyStatus: ReconciliationStatus.RECORDED,
        allergies: [{ ...allergy, name: ' ' }],
      }),
    ).toThrow(BadRequestException);
    expect(() => normalizeClinicalSummary({ ...dto(), reason: '     ' })).toThrow(
      BadRequestException,
    );
  });
  it('rechaza identificadores duplicados y valida DTOs anidados', async () => {
    expect(() =>
      normalizeClinicalSummary({
        ...dto(),
        allergyStatus: ReconciliationStatus.RECORDED,
        allergies: [allergy, allergy],
      }),
    ).toThrow(BadRequestException);
    expect(
      await validate(
        plainToInstance(SaveClinicalSummaryDto, { ...dto(), allergies: [{ name: 'incompleto' }] }),
      ),
    ).not.toHaveLength(0);
  });
  it('exige CAS para pacientes y no acepta campos de borrador en edición', async () => {
    expect(await validate(plainToInstance(UpdatePatientDto, {}))).not.toHaveLength(0);
    expect(
      await validate(
        plainToInstance(UpdatePatientDto, { expectedVersion: 0, draftId: allergy.id }),
        { whitelist: true, forbidNonWhitelisted: true },
      ),
    ).not.toHaveLength(0);
  });
  it('rechaza una revisión obsoleta antes de escribir', async () => {
    const tx = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ isActive: true, fullName: 'Profesional Demo' }),
      },
      patient: { findUnique: jest.fn().mockResolvedValue({ isActive: true }), update: jest.fn() },
      patientClinicalSummaryRevision: {
        findFirst: jest.fn().mockResolvedValue({ version: 1 }),
        create: jest.fn(),
      },
    };
    const prisma = { $transaction: (run: (client: typeof tx) => Promise<unknown>) => run(tx) };
    const service = new ClinicalSummaryService(prisma as unknown as PrismaService);
    await expect(service.save(allergy.id, dto(), allergy.id)).rejects.toThrow(ConflictException);
    expect(tx.patientClinicalSummaryRevision.create).not.toHaveBeenCalled();
    expect(tx.patient.update).not.toHaveBeenCalled();
  });
  it('traduce conflictos de serialización sin revelar detalles internos', async () => {
    const prisma = { $transaction: jest.fn().mockRejectedValue({ code: 'P2034' }) };
    await expect(
      new ClinicalSummaryService(prisma as unknown as PrismaService).save(
        allergy.id,
        dto(),
        allergy.id,
      ),
    ).rejects.toThrow(ConflictException);
  });
});
