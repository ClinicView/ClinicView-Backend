import { plainToInstance } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';
import {
  MAX_ATTACHMENT_ALT_TEXT_LENGTH,
  MAX_ATTACHMENT_CAPTION_LENGTH,
  MAX_RECORD_ATTACHMENTS,
  RecordAttachmentInputDto,
  RecordAttachmentsValidation,
} from '../dto/record-attachment.dto';
import { DeleteRecordMediaQueryDto } from '../dto/record-media.dto';

class AttachmentCollectionDto {
  @RecordAttachmentsValidation()
  attachments?: RecordAttachmentInputDto[];
}

function attachment(index: number): Record<string, unknown> {
  return {
    assetId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  };
}

function constraintNames(errors: ValidationError[]): string[] {
  return errors.flatMap((error) => [
    ...Object.keys(error.constraints ?? {}),
    ...constraintNames(error.children ?? []),
  ]);
}

async function validateAttachments(value: unknown) {
  const dto = plainToInstance(AttachmentCollectionDto, { attachments: value });
  return { dto, errors: await validate(dto) };
}

describe('RecordAttachmentsValidation', () => {
  it('acepta hasta diez adjuntos únicos y omite la propiedad ausente', async () => {
    const maximum = Array.from({ length: MAX_RECORD_ATTACHMENTS }, (_, index) =>
      attachment(index + 1),
    );

    await expect(validateAttachments(undefined)).resolves.toEqual(
      expect.objectContaining({ errors: [] }),
    );
    await expect(validateAttachments(maximum)).resolves.toEqual(
      expect.objectContaining({ errors: [] }),
    );
  });

  it('rechaza más de diez adjuntos y assetId duplicados', async () => {
    const tooMany = Array.from({ length: MAX_RECORD_ATTACHMENTS + 1 }, (_, index) =>
      attachment(index + 1),
    );
    const overLimit = await validateAttachments(tooMany);
    const duplicated = await validateAttachments([attachment(1), attachment(1)]);

    expect(constraintNames(overLimit.errors)).toContain('arrayMaxSize');
    expect(constraintNames(duplicated.errors)).toContain('arrayUnique');
  });

  it('rechaza null explícito en vez de tratarlo como propiedad opcional', async () => {
    const result = await validateAttachments(null);

    expect(constraintNames(result.errors)).toContain('isArray');
  });

  it('normaliza metadatos válidos y aplica sus límites', async () => {
    const valid = await validateAttachments([
      {
        ...attachment(1),
        sectionKey: '  physicalExam.image  ',
        caption: '  Vista frontal  ',
        altText: '  Lesión cutánea frontal  ',
        sortOrder: MAX_RECORD_ATTACHMENTS - 1,
      },
    ]);

    expect(valid.errors).toEqual([]);
    expect(valid.dto.attachments?.[0]).toEqual(
      expect.objectContaining({
        sectionKey: 'physicalExam.image',
        caption: 'Vista frontal',
        altText: 'Lesión cutánea frontal',
        sortOrder: MAX_RECORD_ATTACHMENTS - 1,
      }),
    );

    const invalid = await validateAttachments([
      {
        ...attachment(2),
        sectionKey: '9 clave inválida',
        caption: 'c'.repeat(MAX_ATTACHMENT_CAPTION_LENGTH + 1),
        altText: 'a'.repeat(MAX_ATTACHMENT_ALT_TEXT_LENGTH + 1),
        sortOrder: MAX_RECORD_ATTACHMENTS,
      },
    ]);
    const constraints = constraintNames(invalid.errors);
    expect(constraints).toEqual(expect.arrayContaining(['matches', 'maxLength', 'max']));
  });
});

describe('DeleteRecordMediaQueryDto', () => {
  it('transforma expectedVersion y rechaza versiones inválidas', async () => {
    const valid = plainToInstance(DeleteRecordMediaQueryDto, { expectedVersion: '3' });
    expect(await validate(valid)).toEqual([]);
    expect(valid.expectedVersion).toBe(3);

    const negative = plainToInstance(DeleteRecordMediaQueryDto, { expectedVersion: '-1' });
    const nonNumeric = plainToInstance(DeleteRecordMediaQueryDto, {
      expectedVersion: 'invalid',
    });
    expect(constraintNames(await validate(negative))).toContain('min');
    expect(constraintNames(await validate(nonNumeric))).toContain('isInt');
  });
});
