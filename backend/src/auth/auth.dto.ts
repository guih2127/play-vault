import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GoogleDto {
  @ApiProperty({ description: 'Google Identity Services ID token (JWT)' })
  credential: string;
}

export class RegisterDto {
  @ApiProperty()
  email: string;

  @ApiProperty({ minLength: 8 })
  password: string;

  @ApiPropertyOptional()
  name?: string;
}

export class LoginDto {
  @ApiProperty()
  email: string;

  @ApiProperty()
  password: string;
}

export class ConnectPsnDto {
  @ApiProperty({ description: 'PSN NPSSO token (encrypted at rest)' })
  npsso: string;
}
