import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import {
  HistoryEntryDto,
  HistoryOverviewDto,
  HistorySearchQueryDto,
} from './dto/history-query.dto';
import { normalizedCatalogName } from '../clinical-catalogs/clinical-catalogs.service';

@Injectable()
export class ClinicalHistoryService {
  constructor(private readonly prisma: PrismaService) {}
  private access(permissions: string[]) {
    const records = permissions.includes('records.read');
    const documents = permissions.includes('documents.read');
    if (!records && !documents)
      throw new ForbiddenException('Se requiere lectura de registros o documentos.');
    return { records, documents };
  }
  async search(patientId: string, query: HistorySearchQueryDto, permissions: string[]) {
    const access = this.access(permissions);
    if (query.from && query.to && query.from > query.to)
      throw new BadRequestException('El período está invertido.');
    const page = query.page ?? 1;
    const limit = 20;
    const needle = normalizedCatalogName(query.q ?? '');
    // Text and JSON values stay in SQL; no unbounded client-side fetch to simulate search.
    const entries = Prisma.sql`
      SELECT r.id, 'RECORD'::text AS kind, r.record_type::text AS title, left(r.summary, 360) AS preview,
        r.status::text AS status, r.record_type::text AS "recordType",
        to_char(r.attended_at AT TIME ZONE 'America/Lima', 'YYYY-MM-DD') AS "clinicalFrom",
        to_char(r.attended_at AT TIME ZONE 'America/Lima', 'YYYY-MM-DD') AS "clinicalTo",
        coalesce(r.professional_name_snapshot, r.doctor_name) AS professional, r.service, r.specialty,
        e.title AS "episodeTitle", (c.id IS NOT NULL) AS confirmed, r.created_at AS "createdAt",
        translate(lower(concat_ws(' ', r.summary, r.notes, r.details::text, r.service, r.specialty,
          r.professional_name_snapshot, r.doctor_name, r.preliminary_diagnosis, r.plan, e.title, s.document_name, s.source_note)), 'áéíóúüñ', 'aeiouun') AS haystack
      FROM clinical_records r LEFT JOIN clinical_episodes e ON e.id = r.episode_id
      LEFT JOIN clinical_record_confirmations c ON c.record_id = r.id LEFT JOIN clinical_record_sources s ON s.record_id = r.id
      WHERE r.patient_id = ${patientId}::uuid AND ${access.records}
        AND (${query.episodeId ?? null}::uuid IS NULL OR r.episode_id = ${query.episodeId ?? null}::uuid)
        AND (${query.versions !== 'CURRENT'} OR r.status = 'ACTIVE')
      UNION ALL
      SELECT d.id, 'DOCUMENT'::text, d.original_name,
        CASE WHEN d.status = 'VALIDATED' THEN left(coalesce(d.corrected_text, d.ocr_text, ''), 360) ELSE 'Original pendiente de validación o no vigente; consulta su estado.' END,
        d.status::text, NULL::text, d.clinical_metadata->>'clinicalDate',
        coalesce(d.clinical_metadata->>'clinicalEndDate', d.clinical_metadata->>'clinicalDate'),
        d.clinical_metadata->>'originalProfessional', d.clinical_metadata->>'sourceService', NULL::text, NULL::text,
        (d.status = 'VALIDATED'), d.created_at,
        translate(lower(concat_ws(' ', d.original_name, d.clinical_metadata::text,
          CASE WHEN d.status = 'VALIDATED' THEN coalesce(d.corrected_text, d.ocr_text) ELSE NULL END)), 'áéíóúüñ', 'aeiouun')
      FROM medical_documents d WHERE d.patient_id = ${patientId}::uuid AND ${access.documents}
        AND (${query.episodeId ?? null}::uuid IS NULL OR EXISTS (SELECT 1 FROM clinical_record_sources s JOIN clinical_records r ON r.id = s.record_id WHERE s.document_id = d.id AND r.episode_id = ${query.episodeId ?? null}::uuid))
        AND (${query.versions !== 'CURRENT'} OR d.status = 'VALIDATED')`;
    const filter = Prisma.sql`
      (${needle} = '' OR position(${needle} in haystack) > 0)
      AND (${query.kind ?? null}::text IS NULL OR kind = ${query.kind ?? null})
      AND (${query.recordType ?? null}::text IS NULL OR "recordType" = ${query.recordType ?? null})
      AND (${query.status ?? null}::text IS NULL OR status = ${query.status ?? null})
      AND (${query.from ?? null}::text IS NULL OR "clinicalTo" >= ${query.from ?? null})
      AND (${query.to ?? null}::text IS NULL OR "clinicalFrom" <= ${query.to ?? null})
      AND (${query.confirmation ?? null}::text IS NULL OR (kind = 'RECORD' AND confirmed = ${query.confirmation === 'CONFIRMED'}))`;
    return this.prisma.$transaction(
      async (tx) => {
        if (!(await tx.patient.findUnique({ where: { id: patientId }, select: { id: true } })))
          throw new NotFoundException('Paciente no encontrado.');
        const [data, total] = await Promise.all([
          tx.$queryRaw<
            HistoryEntryDto[]
          >(Prisma.sql`WITH entries AS (${entries}) SELECT id, kind, title, preview, status, "recordType", "clinicalFrom", "clinicalTo", professional, service, specialty, "episodeTitle", confirmed, "createdAt" FROM entries WHERE ${filter}
          ORDER BY coalesce("clinicalFrom", to_char("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Lima', 'YYYY-MM-DD')) DESC, "createdAt" DESC, kind, id DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`),
          tx.$queryRaw<Array<{ count: bigint }>>(
            Prisma.sql`WITH entries AS (${entries}) SELECT count(*) FROM entries WHERE ${filter}`,
          ),
        ]);
        return { data, total: Number(total[0].count), page, limit };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async overview(patientId: string, permissions: string[]): Promise<HistoryOverviewDto> {
    const access = this.access(permissions);
    return this.prisma.$transaction(
      async (tx) => {
        if (!(await tx.patient.findUnique({ where: { id: patientId }, select: { id: true } })))
          throw new NotFoundException('Paciente no encontrado.');
        const [
          activeRecords,
          recordVersions,
          pendingConfirmations,
          documents,
          validatedDocuments,
          openEpisodes,
          dates,
        ] = await Promise.all([
          access.records
            ? tx.clinicalRecord.count({ where: { patientId, status: 'ACTIVE' } })
            : null,
          access.records ? tx.clinicalRecord.count({ where: { patientId } }) : null,
          access.records
            ? tx.clinicalRecord.count({
                where: { patientId, status: 'ACTIVE', confirmation: null },
              })
            : null,
          access.documents ? tx.medicalDocument.count({ where: { patientId } }) : null,
          access.documents
            ? tx.medicalDocument.count({ where: { patientId, status: 'VALIDATED' } })
            : null,
          access.records
            ? tx.clinicalEpisode.count({ where: { patientId, status: 'OPEN' } })
            : null,
          tx.$queryRaw<Array<{ day: string | null }>>`SELECT max(day) AS day FROM (
          SELECT to_char(attended_at AT TIME ZONE 'America/Lima', 'YYYY-MM-DD') AS day FROM clinical_records WHERE patient_id = ${patientId}::uuid AND status = 'ACTIVE' AND ${access.records}
          UNION ALL SELECT coalesce(clinical_metadata->>'clinicalEndDate', clinical_metadata->>'clinicalDate') FROM medical_documents WHERE patient_id = ${patientId}::uuid AND status = 'VALIDATED' AND ${access.documents}
        ) dates`,
        ]);
        return {
          activeRecords,
          recordVersions,
          pendingConfirmations,
          documents,
          validatedDocuments,
          openEpisodes,
          latestClinicalDate: dates[0]?.day ?? null,
          pendingDocuments: access.documents
            ? await tx.medicalDocument.count({
                where: { patientId, status: { notIn: ['VALIDATED', 'REJECTED'] } },
              })
            : null,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
