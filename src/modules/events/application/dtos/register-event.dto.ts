import { IsNotEmpty, IsString, IsEnum, IsOptional, IsObject } from 'class-validator';

export class RegisterEventDto {
  @IsString()
  @IsNotEmpty()
  application!: string;

  @IsString()
  @IsNotEmpty()
  eventType!: string;

  @IsString()
  @IsNotEmpty()
  description!: string;

  @IsEnum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])
  severity!: string;

  @IsString()
  @IsNotEmpty()
  occurredAt!: string;

  @IsObject()
  @IsOptional()
  metadata?: Record<string, any>;
}