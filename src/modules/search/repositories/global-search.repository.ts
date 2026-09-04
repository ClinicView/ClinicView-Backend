import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';

const patientResultSelect = {
  id: true,
  firstName: true,
  lastName: true,
  documentType: true,
  documentNumber: true,
} satisfies Prisma.PatientSelect;

const documentResultSelect = {
  id: true,
  patientId: true,
  originalName: true,
  status: true,
  createdAt: true,
  correctedText: true,
  ocrText: true,
  patient: {
    select: { id: true, firstName: true, lastName: true },
  },
} satisfies Prisma.MedicalDocumentSelect;

export type GlobalPatientSearchRow = Prisma.PatientGetPayload<{
  select: typeof patientResultSelect;
}>;

export type GlobalDocumentSearchRow = Prisma.MedicalDocumentGetPayload<{
  select: typeof documentResultSelect;
}>;

@Injectable()
export class GlobalSearchRepository {
  constructor(private readonly prisma: PrismaService) {}

  searchPatients(query: string, take: number): Promise<GlobalPatientSearchRow[]> {
    return this.prisma.patient.findMany({
      where: {
        isActive: true,
        OR: [
          { firstName: { contains: query, mode: 'insensitive' } },
          { lastName: { contains: query, mode: 'insensitive' } },
          { documentNumber: { contains: query, mode: 'insensitive' } },
        ],
      },
      select: patientResultSelect,
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }],
      take,
    });
  }

  searchDocuments(query: string, take: number): Promise<GlobalDocumentSearchRow[]> {
    return this.prisma.medicalDocument.findMany({
      where: {
        patient: { isActive: true },
        OR: [
          { originalName: { contains: query, mode: 'insensitive' } },
          { correctedText: { contains: query, mode: 'insensitive' } },
          { ocrText: { contains: query, mode: 'insensitive' } },
        ],
      },
      select: documentResultSelect,
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      take,
    });
  }
}
