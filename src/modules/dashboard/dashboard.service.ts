import { Injectable } from '@nestjs/common';
import { DocumentStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

export type ActivityType = 'UPLOADED' | 'CORRECTED' | 'VALIDATED' | 'ERROR' | 'IN_QUEUE';

export interface DashboardActivity {
  id: string;
  type: ActivityType;
  title: string;
  patientName: string | null;
  patientCode: string | null;
  patientId: string | null;
  documentId: string | null;
  occurredAt: Date;
}

export interface DashboardStats {
  patientsToday: number;
  patientsTodayDeltaPct: number | null;
  documentsInQueue: number;
  readyToValidate: number;
  readyToValidateDeltaPct: number | null;
  ocrErrors: number;
  ocrErrorsDeltaPct: number | null;
  recentActivity: DashboardActivity[];
}

const RECENT_ACTIVITY_LIMIT = 8;

function startOfToday(): Date {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function deltaPct(today: number, yesterday: number): number | null {
  if (yesterday === 0) return today > 0 ? 100 : null;
  return Math.round(((today - yesterday) / yesterday) * 100);
}

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getStats(): Promise<DashboardStats> {
    const todayStart = startOfToday();
    const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);

    const [
      patientsToday,
      patientsYesterday,
      documentsInQueue,
      readyToValidate,
      processedToday,
      processedYesterday,
      ocrErrors,
      recentDocuments,
    ] = await this.prisma.$transaction([
      this.prisma.patient.count({ where: { createdAt: { gte: todayStart } } }),
      this.prisma.patient.count({
        where: { createdAt: { gte: yesterdayStart, lt: todayStart } },
      }),
      this.prisma.medicalDocument.count({
        where: { status: { in: [DocumentStatus.PENDING, DocumentStatus.PROCESSING] } },
      }),
      this.prisma.medicalDocument.count({ where: { status: DocumentStatus.PROCESSED } }),
      this.prisma.medicalDocument.count({
        where: { processedAt: { gte: todayStart } },
      }),
      this.prisma.medicalDocument.count({
        where: { processedAt: { gte: yesterdayStart, lt: todayStart } },
      }),
      this.prisma.medicalDocument.count({ where: { status: DocumentStatus.FAILED } }),
      this.prisma.medicalDocument.findMany({
        orderBy: { updatedAt: 'desc' },
        take: RECENT_ACTIVITY_LIMIT,
        include: {
          patient: {
            select: { id: true, firstName: true, lastName: true, documentNumber: true },
          },
        },
      }),
    ]);

    return {
      patientsToday,
      patientsTodayDeltaPct: deltaPct(patientsToday, patientsYesterday),
      documentsInQueue,
      readyToValidate,
      readyToValidateDeltaPct: deltaPct(processedToday, processedYesterday),
      ocrErrors,
      ocrErrorsDeltaPct: null,
      recentActivity: recentDocuments.map((doc) => {
        const { type, title } = this.describeActivity(doc.status, Boolean(doc.correctedAt), doc.id);
        return {
          id: doc.id,
          type,
          title,
          patientName: doc.patient ? `${doc.patient.firstName} ${doc.patient.lastName}` : null,
          patientCode: doc.patient?.documentNumber ?? null,
          patientId: doc.patient?.id ?? null,
          documentId: doc.id,
          occurredAt: doc.updatedAt,
        };
      }),
    };
  }

  private describeActivity(
    status: DocumentStatus,
    hasCorrection: boolean,
    documentId: string,
  ): { type: ActivityType; title: string } {
    const shortId = documentId.slice(0, 8).toUpperCase();
    switch (status) {
      case DocumentStatus.VALIDATED:
        return { type: 'VALIDATED', title: `Historia ${shortId} validada` };
      case DocumentStatus.FAILED:
        return { type: 'ERROR', title: 'Error OCR detectado' };
      case DocumentStatus.REJECTED:
        return { type: 'ERROR', title: `Digitalización ${shortId} rechazada` };
      case DocumentStatus.PROCESSED:
        return hasCorrection
          ? { type: 'CORRECTED', title: 'Corrección de OCR completada' }
          : { type: 'IN_QUEUE', title: 'Documento listo para corregir' };
      default:
        return { type: 'UPLOADED', title: 'Nuevo documento subido' };
    }
  }
}
