import { Controller, Get, Header, Injectable, Query, Request, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiProperty,
  ApiPropertyOptional,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
export class ClinicalWorkQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  page?: number;
  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
  @ApiPropertyOptional({ enum: ['CONFIRMATION', 'DOCUMENT', 'DRAFT'] })
  @IsOptional()
  @IsIn(['CONFIRMATION', 'DOCUMENT', 'DRAFT'])
  kind?: string;
}
export class ClinicalWorkItemDto {
  @ApiProperty() id: string;
  @ApiProperty() resourceId: string;
  @ApiProperty() patientId: string;
  @ApiProperty() patientName: string;
  @ApiProperty() title: string;
  @ApiProperty({ enum: ['CONFIRMATION', 'DOCUMENT', 'DRAFT'] }) kind: string;
  @ApiProperty() createdAt: Date;
}
export class ClinicalWorkPageDto {
  @ApiProperty({ type: [ClinicalWorkItemDto] }) data: ClinicalWorkItemDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
}
@Injectable()
export class ClinicalWorkService {
  constructor(private readonly prisma: PrismaService) {}
  async list(actorId: string, permissions: string[], query: ClinicalWorkQueryDto) {
    const allowed = (...required: string[]) =>
      required.every((permission) => permissions.includes(permission));
    const records = allowed('patients.read', 'records.read', 'records.confirm');
    const documents = allowed('patients.read', 'documents.read', 'documents.validate');
    const drafts = allowed('patients.read', 'records.create');
    const entries = Prisma.sql`
      SELECT 'confirmation:' || r.id::text AS id, r.id AS "resourceId", r.patient_id AS "patientId", concat_ws(', ', p.last_name, p.first_name) AS "patientName", 'Atención por confirmar'::text AS title, 'CONFIRMATION'::text AS kind, r.created_at AS "createdAt"
      FROM clinical_records r JOIN patients p ON p.id = r.patient_id LEFT JOIN clinical_record_confirmations c ON c.record_id = r.id
      WHERE ${records} AND p.is_active AND r.status = 'ACTIVE' AND c.id IS NULL AND (r.professional_id = ${actorId}::uuid OR r.created_by = ${actorId}::uuid)
      UNION ALL
      SELECT 'document:' || d.id::text, d.id, d.patient_id, concat_ws(', ', p.last_name, p.first_name), 'Documento asignado para revisión', 'DOCUMENT', d.created_at
      FROM medical_documents d JOIN patients p ON p.id = d.patient_id WHERE ${documents} AND p.is_active AND d.status IN ('PENDING', 'PROCESSED') AND d.assigned_reviewer_id = ${actorId}::uuid
      UNION ALL
      SELECT 'draft:' || d.id::text, d.id, d.patient_id, concat_ws(', ', p.last_name, p.first_name), 'Borrador clínico por completar', 'DRAFT', d.created_at
      FROM clinical_record_drafts d JOIN patients p ON p.id = d.patient_id WHERE ${drafts} AND p.is_active AND d.actor_id = ${actorId}::uuid AND d.expires_at > CURRENT_TIMESTAMP`;
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const filter = Prisma.sql`(${query.kind ?? null}::text IS NULL OR kind = ${query.kind ?? null})`;
    const [data, total] = await this.prisma.$transaction(
      [
        this.prisma.$queryRaw<ClinicalWorkItemDto[]>(
          Prisma.sql`WITH work AS (${entries}) SELECT * FROM work WHERE ${filter} ORDER BY "createdAt", kind, id LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
        ),
        this.prisma.$queryRaw<Array<{ count: bigint }>>(
          Prisma.sql`WITH work AS (${entries}) SELECT count(*) FROM work WHERE ${filter}`,
        ),
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    return { data, total: Number(total[0].count), page, limit };
  }
}
@ApiTags('clinical-work')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('clinical-work')
export class ClinicalWorkController {
  constructor(private readonly service: ClinicalWorkService) {}
  @Get()
  @Header('Cache-Control', 'private, no-store')
  @ApiResponse({ status: 200, type: ClinicalWorkPageDto })
  list(
    @Query() query: ClinicalWorkQueryDto,
    @Request() req: { user: { sub: string; permissions: string[] } },
  ) {
    return this.service.list(req.user.sub, req.user.permissions, query);
  }
}
