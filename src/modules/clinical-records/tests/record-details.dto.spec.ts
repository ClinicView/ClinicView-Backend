import { validate } from 'class-validator';
import { RecordType } from '@prisma/client';
import { CreateRecordDto } from '../dto/create-record.dto';
import { validateClinicalRecordDetails } from '../dto/record-details.dto';

const VALID_DETAILS: Record<RecordType, Record<string, unknown>> = {
  [RecordType.CONSULTATION]: {
    chiefComplaint: 'Dolor abdominal.',
    vitalSigns: { temperatureCelsius: 37.2, oxygenSaturation: 98 },
    diagnoses: [{ description: 'Dolor abdominal en estudio', code: 'R10.9' }],
  },
  [RecordType.EVOLUTION]: {
    evolution: 'Paciente estable, tolera vía oral.',
    treatmentResponse: 'Respuesta favorable.',
  },
  [RecordType.LAB_RESULT]: {
    studyName: 'Hemograma completo',
    collectedAt: '2020-09-02T09:30:00-05:00',
    results: [
      {
        analyte: 'Hemoglobina',
        value: '13.8',
        unit: 'g/dL',
        referenceRange: '12.0-16.0',
        flag: 'NORMAL',
      },
    ],
  },
  [RecordType.PRESCRIPTION]: {
    indication: 'Infección bacteriana documentada.',
    medications: [
      {
        name: 'Amoxicilina',
        concentration: '500 mg',
        dose: '500 mg',
        route: 'Oral',
        frequency: 'Cada 8 horas',
        duration: '7 días',
      },
    ],
    validFrom: '2026-09-02',
  },
  [RecordType.PROCEDURE]: {
    procedureName: 'Curación de herida',
    technique: 'Lavado con solución salina y cobertura estéril.',
    complications: 'Sin complicaciones.',
    laterality: 'LEFT',
  },
  [RecordType.THERAPY_NOTE]: {
    discipline: 'Terapia física',
    sessionNumber: 4,
    interventions: 'Ejercicios activos asistidos.',
    response: 'Tolera la sesión sin dolor adicional.',
    measurements: [{ name: 'Flexión de rodilla', value: '105', unit: 'grados' }],
  },
  [RecordType.OTHER]: {
    title: 'Junta médica',
    category: 'Nota interdisciplinaria',
    content: 'Se revisó el plan terapéutico con el equipo tratante.',
  },
};

describe('clinical record details v1', () => {
  it.each(Object.values(RecordType))('acepta el esquema válido de %s', (recordType) => {
    const result = validateClinicalRecordDetails(recordType, VALID_DETAILS[recordType]);
    expect(result.errors).toEqual([]);
    expect(result.value).toEqual(VALID_DETAILS[recordType]);
  });

  it('rechaza campos de otra plantilla y propiedades desconocidas', () => {
    const result = validateClinicalRecordDetails(RecordType.PRESCRIPTION, {
      chiefComplaint: 'Campo de consulta.',
      medications: [],
      extra: true,
    });
    expect(result.value).toBeNull();
    expect(result.errors.join(' ')).toContain('chiefComplaint');
    expect(result.errors.join(' ')).toContain('extra');
    expect(result.errors.join(' ')).toContain('medications');
  });

  it('valida elementos repetibles y límites numéricos', () => {
    const lab = validateClinicalRecordDetails(RecordType.LAB_RESULT, {
      studyName: 'Gasometría',
      results: [{ analyte: 'pH', value: '' }],
    });
    expect(lab.errors.join(' ')).toContain('results.0.value');

    const consultation = validateClinicalRecordDetails(RecordType.CONSULTATION, {
      chiefComplaint: 'Control',
      vitalSigns: { oxygenSaturation: 150 },
    });
    expect(consultation.errors.join(' ')).toContain('oxygenSaturation');
  });

  it('exige fechas zonadas en campos clínicos datetime', () => {
    const result = validateClinicalRecordDetails(RecordType.LAB_RESULT, {
      studyName: 'Perfil renal',
      collectedAt: '2026-09-02T09:30',
      results: [{ analyte: 'Creatinina', value: '0.9' }],
    });
    expect(result.errors.join(' ')).toContain('collectedAt');
  });

  it('rechaza cronologías clínicas invertidas', () => {
    const lab = validateClinicalRecordDetails(RecordType.LAB_RESULT, {
      studyName: 'Perfil renal',
      collectedAt: '2026-09-02T10:30:00-05:00',
      issuedAt: '2026-09-02T09:30:00-05:00',
      results: [{ analyte: 'Creatinina', value: '0.9' }],
    });
    expect(lab.errors).toContain('details.issuedAt: no puede ser anterior a details.collectedAt.');

    const prescription = validateClinicalRecordDetails(RecordType.PRESCRIPTION, {
      medications: [
        {
          name: 'Amoxicilina',
          dose: '500 mg',
          route: 'Oral',
          frequency: 'Cada 8 horas',
          duration: '7 días',
        },
      ],
      validFrom: '2026-09-10',
      validUntil: '2026-09-09',
    });
    expect(prescription.errors).toContain(
      'details.validUntil: no puede ser anterior a details.validFrom.',
    );
  });

  it('permite un details parcial de borrador y elimina vacíos sin aceptar desconocidos', () => {
    const partial = validateClinicalRecordDetails(
      RecordType.PRESCRIPTION,
      {
        indication: '',
        medications: [{ name: 'Amoxicilina', dose: '' }],
      },
      { partial: true },
    );
    expect(partial.errors).toEqual([]);
    expect(partial.value).toEqual({ medications: [{ name: 'Amoxicilina' }] });

    const unknown = validateClinicalRecordDetails(
      RecordType.PRESCRIPTION,
      { campoInventado: 'x' },
      { partial: true },
    );
    expect(unknown.errors.join(' ')).toContain('campoInventado');
  });

  it('integra la unión discriminada con class-validator en CreateRecordDto', async () => {
    const valid = Object.assign(new CreateRecordDto(), {
      recordType: RecordType.OTHER,
      attendedAt: '2020-09-02T14:30:00Z',
      summary: 'Nota interdisciplinaria.',
      details: VALID_DETAILS[RecordType.OTHER],
    });
    expect(await validate(valid)).toEqual([]);

    const invalid = Object.assign(new CreateRecordDto(), {
      recordType: RecordType.OTHER,
      attendedAt: '2020-09-02T14:30:00Z',
      summary: 'Nota interdisciplinaria.',
      details: VALID_DETAILS[RecordType.CONSULTATION],
    });
    const errors = await validate(invalid);
    expect(errors.find((error) => error.property === 'details')).toBeDefined();
  });
});
