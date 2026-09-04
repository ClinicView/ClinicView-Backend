import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../core/rbac/permissions.guard';
import { RequirePermissions } from '../../core/rbac/requires-permissions.decorator';
import { ReviewService } from './review.service';
import { FindReviewQueueQueryDto } from './dto/find-review-queue-query.dto';
import {
  AssignReviewDocumentDto,
  FindReviewAssigneesQueryDto,
  ReleaseReviewDocumentDto,
  UpdateReviewPriorityDto,
} from './dto/review-assignment.dto';
import {
  ReviewAssigneesResponseDto,
  ReviewAssignmentResponseDto,
  ReviewQueuePageDto,
} from './dto/review-queue-item.dto';
import { AUDIT_ACTIONS } from '../audit/audit-action';
import { Audited } from '../audit/audit.decorator';

interface ReviewRequest {
  user: { sub: string; permissions: string[] };
}

@ApiTags('review')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('review')
export class ReviewController {
  constructor(private readonly service: ReviewService) {}

  @Get('queue')
  @RequirePermissions('review.read')
  @Header('Cache-Control', 'private, no-store, max-age=0')
  @ApiOperation({
    summary: 'Cola de revisión — documentos procesados pendientes de validación clínica',
    description:
      'Todo usuario con review.read puede consultar los alcances AVAILABLE, MINE, UNASSIGNED y ALL. ' +
      'La visibilidad es de solo lectura; tomar, asignar, liberar o priorizar exige review.assign.',
  })
  @ApiResponse({ status: 200, type: ReviewQueuePageDto })
  getQueue(
    @Query() query: FindReviewQueueQueryDto,
    @Request() request: ReviewRequest,
  ): Promise<ReviewQueuePageDto> {
    return this.service.getQueue(query, request.user.sub);
  }

  @Get('assignees')
  @RequirePermissions('review.assign')
  @Header('Cache-Control', 'private, no-store, max-age=0')
  @ApiOperation({
    summary: 'Buscar revisores activos habilitados para abrir y validar documentos',
    description:
      'Un revisor elegible debe conservar review.read, documents.read y documents.validate.',
  })
  @ApiResponse({ status: 200, type: ReviewAssigneesResponseDto })
  listAssignees(
    @Query() query: FindReviewAssigneesQueryDto,
  ): Promise<ReviewAssigneesResponseDto> {
    return this.service.listAssignees(query.q ?? '');
  }

  @Post('documents/:id/claim')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('review.assign')
  @Audited(AUDIT_ACTIONS.DOCUMENT_REVIEW_CLAIMED, {
    resourceType: 'MEDICAL_DOCUMENT',
    resourceParam: 'id',
  })
  @ApiOperation({ summary: 'Tomar para el usuario actual un documento sin asignar' })
  @ApiResponse({ status: 200, type: ReviewAssignmentResponseDto })
  @ApiConflictResponse({ description: 'El documento fue asignado o modificado concurrentemente.' })
  @ApiNotFoundResponse({ description: 'Documento no encontrado.' })
  claim(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReleaseReviewDocumentDto,
    @Request() request: ReviewRequest,
  ): Promise<ReviewAssignmentResponseDto> {
    return this.service.claim(id, dto.expectedVersion, request.user.sub);
  }

  @Patch('documents/:id/assignment')
  @RequirePermissions('review.assign')
  @Audited(AUDIT_ACTIONS.DOCUMENT_REVIEW_ASSIGNED, {
    resourceType: 'MEDICAL_DOCUMENT',
    resourceParam: 'id',
  })
  @ApiOperation({ summary: 'Asignar o reasignar un documento a un revisor habilitado' })
  @ApiResponse({ status: 200, type: ReviewAssignmentResponseDto })
  @ApiConflictResponse({ description: 'Revisor no elegible o version desactualizada.' })
  @ApiNotFoundResponse({ description: 'Documento no encontrado.' })
  assign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignReviewDocumentDto,
    @Request() request: ReviewRequest,
  ): Promise<ReviewAssignmentResponseDto> {
    return this.service.assign(id, dto, request.user.sub);
  }

  @Post('documents/:id/release')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('review.assign')
  @Audited(AUDIT_ACTIONS.DOCUMENT_REVIEW_RELEASED, {
    resourceType: 'MEDICAL_DOCUMENT',
    resourceParam: 'id',
  })
  @ApiOperation({ summary: 'Liberar la asignacion actual y devolver el documento a la cola' })
  @ApiResponse({ status: 200, type: ReviewAssignmentResponseDto })
  @ApiConflictResponse({ description: 'El documento ya no esta asignado o cambio de version.' })
  @ApiNotFoundResponse({ description: 'Documento no encontrado.' })
  release(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReleaseReviewDocumentDto,
    @Request() request: ReviewRequest,
  ): Promise<ReviewAssignmentResponseDto> {
    return this.service.release(id, dto.expectedVersion, request.user.sub);
  }

  @Patch('documents/:id/priority')
  @RequirePermissions('review.assign')
  @Audited(AUDIT_ACTIONS.DOCUMENT_REVIEW_PRIORITY_CHANGED, {
    resourceType: 'MEDICAL_DOCUMENT',
    resourceParam: 'id',
  })
  @ApiOperation({ summary: 'Cambiar la prioridad de un documento pendiente de revision' })
  @ApiResponse({ status: 200, type: ReviewAssignmentResponseDto })
  @ApiConflictResponse({ description: 'El documento ya no esta pendiente o cambio de version.' })
  @ApiNotFoundResponse({ description: 'Documento no encontrado.' })
  updatePriority(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateReviewPriorityDto,
    @Request() request: ReviewRequest,
  ): Promise<ReviewAssignmentResponseDto> {
    return this.service.updatePriority(id, dto, request.user.sub);
  }
}
