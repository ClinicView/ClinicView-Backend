import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Min } from 'class-validator';

export class ProcessDocumentDto {
  @ApiPropertyOptional({
    minimum: 0,
    description:
      'Version displayed by the caller; repeated submissions of the same accepted version do not start another job.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  expectedVersion?: number;
}
