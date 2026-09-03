import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class BeatenDto {
  @ApiProperty()
  key: string;

  @ApiProperty()
  beaten: boolean;
}

export class PlayingDto {
  @ApiProperty()
  key: string;

  @ApiProperty()
  playing: boolean;
}

export class RatingDto {
  @ApiProperty()
  key: string;

  @ApiProperty({ minimum: 0, maximum: 5, description: '0.5–5 stars (0 clears the rating)' })
  rating: number;
}

export class ManualHoursDto {
  @ApiProperty({ description: 'Hours played (0 or less clears the playtime)' })
  hours: number;
}

export class ManualGameDto {
  @ApiProperty()
  title: string;

  @ApiProperty()
  platform: string;

  @ApiPropertyOptional()
  hours?: number;

  @ApiPropertyOptional()
  beaten?: boolean;

  @ApiPropertyOptional()
  coverUrl?: string;
}

export class BacklogDto {
  @ApiProperty()
  title: string;

  @ApiProperty()
  platform: string;

  @ApiPropertyOptional()
  coverUrl?: string;

  @ApiPropertyOptional({ description: '0 = Low, 1 = Medium, 2 = High' })
  priority?: number;

  @ApiPropertyOptional()
  notes?: string;
}

export class BacklogPriorityDto {
  @ApiProperty({ description: '0 = Low, 1 = Medium, 2 = High' })
  priority: number;
}
