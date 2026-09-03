import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOperation,
  ApiUnauthorizedResponse,
  ApiTags,
} from '@nestjs/swagger';
import { PermissionsGuard } from '../../core/rbac/permissions.guard';
import { RequirePermissions } from '../../core/rbac/requires-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DashboardService } from './dashboard.service';
import type { DashboardStats } from './dashboard.service';

@ApiTags('dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  @Get('stats')
  @RequirePermissions('patients.read', 'documents.read')
  @Header('Cache-Control', 'private, no-store, max-age=0')
  @Header('Pragma', 'no-cache')
  @ApiOperation({
    summary:
      'Indicadores del panel: pacientes hoy, cola, listos para validar, errores OCR y actividad reciente',
    description:
      'Incluye datos identificables de pacientes y actividad documental. Requiere simultáneamente patients.read y documents.read.',
  })
  @ApiUnauthorizedResponse({ description: 'Token de acceso ausente o inválido.' })
  @ApiForbiddenResponse({
    description: 'Requiere patients.read y documents.read; no se entrega una respuesta parcial.',
  })
  getStats(): Promise<DashboardStats> {
    return this.service.getStats();
  }
}
