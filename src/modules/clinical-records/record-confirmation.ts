import { createHash } from 'node:crypto';
import { ClinicalRecordConfirmation } from '@prisma/client';
import { RecordWithCount } from './repositories/clinical-records.repository';
import { RecordConfirmationDto } from './dto/confirm-record.dto';

function canonical(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  return JSON.stringify(value ?? null);
}

/** Huella de contenido, no de estado/versiones operacionales. No es una firma digital. */
export function clinicalContentHash(record: RecordWithCount): string {
  const content = {
    id: record.id,
    patientId: record.patientId,
    recordType: record.recordType,
    origin: record.origin,
    attendedAt: record.attendedAt,
    attendancePrecision: record.attendancePrecision,
    summary: record.summary,
    notes: record.notes,
    details: record.details,
    schemaVersion: record.schemaVersion,
    professionalId: record.professionalId,
    professionalName: record.professionalNameSnapshot,
    doctorName: record.doctorName,
    license: record.professionalLicenseSnapshot,
    service: record.service,
    diagnosis: record.preliminaryDiagnosis,
    plan: record.plan,
    priority: record.priority,
    attachments: record.attachments.map((a) => ({
      assetId: a.assetId,
      sha256: a.asset.sha256,
      sectionKey: a.sectionKey,
      caption: a.caption,
      altText: a.altText,
      sortOrder: a.sortOrder,
    })),
    source: record.source ?? null,
  };
  return createHash('sha256').update(canonical(content)).digest('hex');
}

export function recordConfirmationResponse(
  value?: ClinicalRecordConfirmation | null,
): RecordConfirmationDto | null {
  if (!value) return null;
  return {
    recordVersion: value.recordVersion,
    actorId: value.actorId,
    actorName: value.actorName,
    actorUsername: value.actorUsername,
    capacity: value.capacity,
    note: value.note,
    contentHash: value.contentHash,
    confirmedAt: value.confirmedAt,
  };
}
