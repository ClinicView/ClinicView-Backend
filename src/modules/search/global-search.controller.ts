import { Controller, Get, Header, Query, Request, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { PermissionsGuard } from '../../core/rbac/permissions.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AUDIT_ACTIONS } from '../audit/audit-action';
import { Audited } from '../audit/audit.decorator';
import { GlobalSearchQueryDto } from './dto/global-search-query.dto';
import { GlobalSearchResponseDto } from './dto/global-search-response.dto';
import { GlobalSearchService } from './global-search.service';

interface SearchRequest {
  user: { permissions: string[] };
}

@ApiTags('search')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('search')
export class GlobalSearchController {
  constructor(private readonly service: GlobalSearchService) {}

  @Get()
  @Audited(AUDIT_ACTIONS.GLOBAL_SEARCH_PERFORMED, { resourceType: 'SEARCH' })
  @Header('Cache-Control', 'private, no-store, max-age=0')
  @Header('Pragma', 'no-cache')
  @ApiOperation({
    summary: 'Buscar pacientes y documentos segun los permisos efectivos de la sesion',
  })
  @ApiResponse({ status: 200, type: GlobalSearchResponseDto })
  @ApiForbiddenResponse({ description: 'No posee permisos de lectura en ninguna categoria.' })
  search(
    @Query() query: GlobalSearchQueryDto,
    @Request() request: SearchRequest,
  ): Promise<GlobalSearchResponseDto> {
    return this.service.search(query, request.user.permissions);
  }
}
