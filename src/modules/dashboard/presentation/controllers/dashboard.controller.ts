import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { GetDashboardMetricsUseCase, DashboardMetrics } from '../../application/use-cases/get-dashboard-metrics.use-case';
import { JwtAuthGuard } from '../../../shared/guards/jwt-auth.guard';

@ApiTags('Dashboard')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly getMetricsUseCase: GetDashboardMetricsUseCase) {}

  @Get('metrics')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Obtener métricas consolidadas del panel de control' })
  @ApiResponse({ status: 200, description: 'Estructura unificada de métricas del sistema' })
  async getMetrics(): Promise<DashboardMetrics> {
    return this.getMetricsUseCase.execute();
  }
}