import { IsEnum, IsNotEmpty, IsUUID } from 'class-validator';

export class UpdateStatusDto {
  @IsUUID() @IsNotEmpty() id!: string;
  @IsEnum(['OPEN', 'IN_PROGRESS', 'RESOLVED']) status!: string;
}