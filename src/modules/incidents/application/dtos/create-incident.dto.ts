import { IsNotEmpty, IsString, IsEnum, IsOptional, IsArray } from 'class-validator';

export class CreateIncidentDto {
  @IsString() @IsNotEmpty() title!: string;
  @IsString() @IsOptional() description?: string;
  @IsString() @IsNotEmpty() affectedApplication!: string;
  @IsEnum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']) severity!: string;
  @IsString() @IsOptional() assignee?: string;
  @IsArray() @IsString({ each: true }) @IsOptional() relatedEventTraceIds?: string[];
}