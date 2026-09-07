import {
  Body,
  Controller,
  Get,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../core/rbac/permissions.guard';
import { RequirePermissions } from '../../core/rbac/requires-permissions.decorator';
import { Audited } from '../audit/audit.decorator';
import { AUDIT_ACTIONS } from '../audit/audit-action';
import { ClinicalCatalogsService } from './clinical-catalogs.service';
import {
  CatalogEntryDto,
  CatalogPageDto,
  CatalogQueryDto,
  CreateCatalogEntryDto,
  UpdateCatalogEntryDto,
} from './catalog.dto';
@ApiTags('clinical-catalogs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('clinical-catalogs')
export class ClinicalCatalogsController {
  constructor(private readonly service: ClinicalCatalogsService) {}
  @Get()
  @ApiResponse({ status: 200, type: CatalogPageDto })
  list(@Query() query: CatalogQueryDto) {
    return this.service.list(query);
  }
  @Post()
  @RequirePermissions('catalogs.manage')
  @ApiResponse({ status: 201, type: CatalogEntryDto })
  @Audited(AUDIT_ACTIONS.CATALOG_CREATED, {
    resourceType: 'CLINICAL_CATALOG',
    resourceFromResponseId: true,
  })
  create(@Body() dto: CreateCatalogEntryDto, @Request() req: { user: { sub: string } }) {
    return this.service.create(dto, req.user.sub);
  }
  @Patch(':id')
  @RequirePermissions('catalogs.manage')
  @ApiResponse({ status: 200, type: CatalogEntryDto })
  @Audited(AUDIT_ACTIONS.CATALOG_UPDATED, { resourceType: 'CLINICAL_CATALOG', resourceParam: 'id' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCatalogEntryDto,
    @Request() req: { user: { sub: string } },
  ) {
    return this.service.update(id, dto, req.user.sub);
  }
}
@Module({ controllers: [ClinicalCatalogsController], providers: [ClinicalCatalogsService] })
export class ClinicalCatalogsModule {}
