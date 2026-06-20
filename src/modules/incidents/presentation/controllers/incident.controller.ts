import { Controller, Post, Get, Patch, Body, Query, Param, Req, UseGuards, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiHeader, ApiParam } from '@nestjs/swagger';
import { CreateIncidentUseCase } from '../../application/use-cases/create-incident.use-case';
import { UpdateIncidentStatusUseCase } from '../../application/use-cases/update-incident-status.use-case';
import { CreateIncidentDto } from '../../application/dtos/create-incident.dto';
import { UpdateStatusDto } from '../../application/dtos/update-status.dto';
import { IncidentFiltersDto } from '../../application/dtos/incident-filters.dto';
import { JwtAuthGuard } from '../../../shared/guards/jwt-auth.guard';
import { ApiKeyGuard } from '../../../shared/guards/api-key.guard';
import { IIncidentRepository } from '../../domain/repositories/i-incident.repository';
import { Inject } from '@nestjs/common';

@ApiTags('Incidents')
@Controller('incidents')
export class IncidentController {
  constructor(
    private readonly createUseCase: CreateIncidentUseCase,
    private readonly updateStatusUseCase: UpdateIncidentStatusUseCase,
    @Inject('IIncidentRepository')
    private readonly repo: IIncidentRepository,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Crear un nuevo incidente vinculado a identificadores de traza de eventos' })
  @ApiResponse({ status: 201, description: 'Incidente persistido exitosamente en PostgreSQL' })
  @ApiResponse({ status: 400, description: 'Error de validación en los campos enviados' })
  @ApiResponse({ status: 401, description: 'No autorizado - Token inválido o no proporcionado' })
  async create(@Body() dto: CreateIncidentDto, @Req() req: any) {
    const traceId = req.traceId || 'trace-system-generated';
    return this.createUseCase.execute(dto, traceId);
  }

  @Get()
  @UseGuards(ApiKeyGuard)
  @ApiHeader({ name: 'x-api-key', description: 'Llave de seguridad secreta para la integración' })
  @ApiOperation({ summary: 'Obtener incidentes paginados con filtros para sistemas externos' })
  @ApiResponse({ status: 200, description: 'Listado de incidentes paginado devuelto exitosamente' })
  @ApiResponse({ status: 401, description: 'API Key inválida o no proporcionada' })
  async findByFilters(@Query() filters: IncidentFiltersDto) {
    return this.repo.findByFilters(filters);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT')
  @ApiParam({ name: 'id', description: 'UUID del incidente', type: 'string' })
  @ApiOperation({ summary: 'Obtener un incidente completo por su UUID' })
  @ApiResponse({ status: 200, description: 'Incidente encontrado y retornado' })
  @ApiResponse({ status: 401, description: 'No autorizado - Token JWT inválido o ausente' })
  @ApiResponse({ status: 404, description: 'Incidente no encontrado' })
  async findById(@Param('id') id: string) {
    const incident = await this.repo.findById(id);
    if (!incident) {
      throw new NotFoundException(`Incidente con id ${id} no encontrado`);
    }
    return incident;
  }

  @Patch(':id/status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT')
  @ApiParam({ name: 'id', description: 'UUID del incidente', type: 'string' })
  @ApiOperation({ summary: 'Actualizar el estado del ciclo de vida transaccional del incidente' })
  @ApiResponse({ status: 200, description: 'Estado actualizado y auditado atómicamente' })
  @ApiResponse({ status: 400, description: 'Id de incidente no válido' })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({ status: 409, description: 'Conflicto - Transición de estado no permitida por el dominio' })
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: Omit<UpdateStatusDto, 'id'>,
    @Req() req: any,
  ) {
    const user = req.user?.email || 'operador.pruebas@coordinadora.com';
    const traceId = req.traceId || 'trace-system-generated';
    return this.updateStatusUseCase.execute({ id, status: dto.status }, user, traceId);
  }
}