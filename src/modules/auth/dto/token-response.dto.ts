import { ApiProperty } from '@nestjs/swagger';

export class TokenResponseDto {
  @ApiProperty()
  access_token: string;

  @ApiProperty({ default: 'Bearer' })
  token_type: string;

  @ApiProperty({ example: 900, description: 'Vigencia del access token en segundos.' })
  expires_in: number;
}
