import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  AssignReviewDocumentDto,
  FindReviewAssigneesQueryDto,
  ReleaseReviewDocumentDto,
  UpdateReviewPriorityDto,
} from '../dto/review-assignment.dto';

const USER_ID = 'bd1d134f-64ac-435d-a836-70fdf0764f70';

describe('DTO de asignación de revisión', () => {
  it('acepta UUID y transforma expectedVersion numérica', async () => {
    const dto = plainToInstance(AssignReviewDocumentDto, {
      assigneeId: USER_ID,
      expectedVersion: '4',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.expectedVersion).toBe(4);
  });

  it.each([
    { assigneeId: 'no-es-uuid', expectedVersion: 0 },
    { assigneeId: USER_ID, expectedVersion: -1 },
    { assigneeId: USER_ID, expectedVersion: 'NaN' },
  ])('rechaza asignaciones inválidas: %o', async (input) => {
    const errors = await validate(plainToInstance(AssignReviewDocumentDto, input));
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rechaza prioridad fuera del contrato y versión negativa', async () => {
    const errors = await validate(plainToInstance(UpdateReviewPriorityDto, {
      priority: 'CRITICAL',
      expectedVersion: -1,
    }));

    expect(errors.map(({ property }) => property).sort()).toEqual([
      'expectedVersion',
      'priority',
    ]);
  });

  it('valida la versión al liberar y el límite de la búsqueda de revisores', async () => {
    const releaseErrors = await validate(plainToInstance(ReleaseReviewDocumentDto, {
      expectedVersion: -1,
    }));
    const queryErrors = await validate(plainToInstance(FindReviewAssigneesQueryDto, {
      q: 'x'.repeat(51),
    }));

    expect(releaseErrors).toHaveLength(1);
    expect(queryErrors).toHaveLength(1);
  });
});
