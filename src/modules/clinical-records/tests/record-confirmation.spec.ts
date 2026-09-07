import { clinicalContentHash } from '../record-confirmation';
import { RecordWithCount } from '../repositories/clinical-records.repository';

describe('clinical content fingerprint', () => {
  const record = { id: 'record', patientId: 'patient', summary: 'Resumen sintético', attendedAt: new Date('2023-09-27T05:00:00Z'), attendancePrecision: 'DAY', details: { chiefComplaint: 'Control', physicalExam: 'Sin cambios' }, attachments: [], source: null } as unknown as RecordWithCount;
  it('is independent of JSON key order and operational status/version', () => {
    expect(clinicalContentHash({ ...record, version: 8, status: 'CORRECTED', details: { physicalExam: 'Sin cambios', chiefComplaint: 'Control' } })).toBe(clinicalContentHash(record));
  });
  it('changes when clinical text, date precision or professional attribution changes', () => {
    for (const patch of [{ summary: 'Otro texto' }, { attendancePrecision: 'INSTANT' }, { professionalNameSnapshot: 'Otro profesional' }]) {
      expect(clinicalContentHash({ ...record, ...patch })).not.toBe(clinicalContentHash(record));
    }
  });
});
