import { RecordType } from '@prisma/client';
import { validateClinicalRecordDetails } from '../dto/record-details.dto';
describe('additive template extensions', () => {
  const cases: Array<[RecordType, object, object]> = [
    ['CONSULTATION', { chiefComplaint: 'Control' }, { careInstructions: 'Orientación documentada' }],
    ['EVOLUTION', { evolution: 'Evolución registrada' }, { disposition: 'Seguimiento documentado' }],
    ['LAB_RESULT', { studyName: 'Estudio', results: [{ analyte: 'Analito', value: 'Valor' }] }, { methodology: 'Método informado', sampleCondition: 'Condición informada', criticalResultCommunication: 'Comunicación documentada' }],
    ['PRESCRIPTION', { medications: [{ name: 'Fármaco de prueba', dose: 'Pauta explícita', route: 'Vía consignada', frequency: 'Frecuencia consignada', duration: 'Duración consignada' }] }, { safetyReview: 'Verificación consignada' }],
    ['PROCEDURE', { procedureName: 'Procedimiento', technique: 'Técnica', complications: 'Sin complicaciones documentadas' }, { materials: 'Materiales consignados', specimenDestination: 'Destino consignado' }],
    ['THERAPY_NOTE', { discipline: 'Disciplina', interventions: 'Intervenciones', response: 'Respuesta' }, { sessionDurationMinutes: 45, tolerance: 'Tolerancia consignada' }],
    ['OTHER', { title: 'Título', category: 'Categoría', content: 'Contenido' }, { recipient: 'Destinatario', purpose: 'Finalidad' }],
  ];
  it.each(cases)('preserves optional fields for %s without changing older records', (type, required, additions) => {
    expect(validateClinicalRecordDetails(type, required).value).toEqual(required);
    expect(validateClinicalRecordDetails(type, { ...required, ...additions }).value).toEqual({ ...required, ...additions });
  });
  it('rejects fractional/zero therapy duration and oversized communication', () => {
    const base = { discipline: 'Disciplina', interventions: 'Intervenciones', response: 'Respuesta' };
    expect(validateClinicalRecordDetails('THERAPY_NOTE', { ...base, sessionDurationMinutes: 0 }).value).toBeNull();
    expect(validateClinicalRecordDetails('THERAPY_NOTE', { ...base, sessionDurationMinutes: 1.5 }).value).toBeNull();
  });
});
