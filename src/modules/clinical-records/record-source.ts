import type { ClinicalRecordSource } from '@prisma/client';
import type { RecordSourceDto } from './dto/publish-record.dto';

export function recordSourceResponse(
  source: ClinicalRecordSource | null | undefined,
): RecordSourceDto | null {
  if (!source) return null;
  return {
    documentId: source.documentId,
    documentVersion: source.documentVersion,
    documentName: source.documentName,
    documentMetadata: source.documentMetadata as Record<string, unknown>,
    pageFrom: source.pageFrom,
    pageTo: source.pageTo,
    sourceNote: source.sourceNote,
    publishedBy: source.publishedBy,
    publishedByName: source.publishedByName,
    publishedAt: source.publishedAt,
  };
}
