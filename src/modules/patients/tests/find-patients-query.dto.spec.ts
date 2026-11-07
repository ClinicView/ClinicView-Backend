import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { FindPatientsQueryDto, PatientListStatus } from '../dto/find-patients-query.dto';

describe('FindPatientsQueryDto', () => {
  it('mantiene pacientes activos por defecto y transforma la paginación', async () => {
    const query = plainToInstance(FindPatientsQueryDto, { page: '2', limit: '10' });

    expect(await validate(query)).toHaveLength(0);
    expect(query).toMatchObject({ status: PatientListStatus.ACTIVE, page: 2, limit: 10 });
  });

  it.each(Object.values(PatientListStatus))('acepta el estado %s', async (status) => {
    const query = plainToInstance(FindPatientsQueryDto, { status, search: 'García' });

    expect(await validate(query)).toHaveLength(0);
    expect(query.status).toBe(status);
  });

  it.each(['archived', 'ACTIVE', '', ['active', 'inactive']])(
    'rechaza un filtro de estado inválido: %j',
    async (status) => {
      const query = plainToInstance(FindPatientsQueryDto, { status });
      const errors = await validate(query);

      expect(errors.find((error) => error.property === 'status')?.constraints).toHaveProperty(
        'isEnum',
      );
    },
  );
});
