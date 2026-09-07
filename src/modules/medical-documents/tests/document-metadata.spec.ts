import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  DocumentClinicalMetadataDto,
  UpdateDocumentMetadataDto,
  normalizeDocumentMetadata,
} from '../dto/document-metadata.dto';

describe('Fechas y procedencia documentales', () => {
  it('conserva fechas civiles sin convertirlas a la fecha de carga', () => {
    expect(
      normalizeDocumentMetadata({
        clinicalDate: '2023-09-27',
        sourceInstitution: ' Clínica demo ',
      }),
    ).toEqual({ clinicalDate: '2023-09-27', sourceInstitution: 'Clínica demo' });
    expect(normalizeDocumentMetadata({ sourceNotes: '' })).toEqual({});
  });
  it('rechaza un rango invertido o sin inicio', () => {
    expect(() => normalizeDocumentMetadata({ clinicalEndDate: '2023-09-27' })).toThrow(
      BadRequestException,
    );
    expect(() =>
      normalizeDocumentMetadata({ clinicalDate: '2023-10-01', clinicalEndDate: '2023-09-27' }),
    ).toThrow(BadRequestException);
  });
  it.each(['2023-02-30', '2023-09-27T00:00:00Z', '2999-01-01'])(
    'rechaza fecha inválida %s',
    async (clinicalDate) => {
      expect(
        await validate(plainToInstance(DocumentClinicalMetadataDto, { clinicalDate })),
      ).not.toHaveLength(0);
    },
  );
  it('acepta páginas multipart pero rechaza fracciones, claves y tipos no reconocidos', async () => {
    expect(
      await validate(plainToInstance(DocumentClinicalMetadataDto, { pageCount: '2' })),
    ).toHaveLength(0);
    for (const data of [
      { pageCount: 2.5 },
      { pageCount: 0 },
      { documentKind: 'GUESS' },
      { inventedField: true },
    ]) {
      expect(
        await validate(plainToInstance(DocumentClinicalMetadataDto, data), {
          whitelist: true,
          forbidNonWhitelisted: true,
        }),
      ).not.toHaveLength(0);
    }
  });
  it('exige versión, motivo y metadata estructurada al corregir', async () => {
    expect(await validate(plainToInstance(UpdateDocumentMetadataDto, {}))).not.toHaveLength(0);
    expect(
      await validate(
        plainToInstance(UpdateDocumentMetadataDto, {
          expectedVersion: 0,
          reason: 'Corregir fecha desde el original',
          metadata: { clinicalDate: '2023-09-27' },
        }),
      ),
    ).toHaveLength(0);
  });
});
