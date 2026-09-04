import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GlobalSearchQueryDto } from '../dto/global-search-query.dto';

describe('GlobalSearchQueryDto', () => {
  it('normaliza espacios y transforma el limite', async () => {
    const dto = plainToInstance(GlobalSearchQueryDto, { q: '  Maria  ', limit: '4' });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.q).toBe('Maria');
    expect(dto.limit).toBe(4);
  });

  it('rechaza consultas de menos de dos caracteres', async () => {
    const dto = plainToInstance(GlobalSearchQueryDto, { q: ' a ' });
    expect(await validate(dto)).not.toHaveLength(0);
  });
});
