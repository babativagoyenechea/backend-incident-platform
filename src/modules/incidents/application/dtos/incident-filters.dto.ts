import { IsOptional, IsEnum, IsString, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class IncidentFiltersDto {
  @IsOptional() @IsEnum(['OPEN', 'IN_PROGRESS', 'RESOLVED']) status?: string;
  @IsOptional() @IsEnum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']) severity?: string;
  @IsOptional() @IsString() application?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number = 20;
}