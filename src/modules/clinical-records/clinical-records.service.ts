import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { RecordOrigin, RecordStatus } from '@prisma/client';
import { parseClinicalDateFilter } from '../../common/validation/clinical-date';
import { PrismaService } from '../../database/prisma.service';
import { CorrectRecordDto } from './dto/correct-record.dto';
import { CreateRecordDto } from './dto/create-record.dto';
import { FindRecordsQueryDto } from './dto/find-records-query.dto';
import { RecordResponseDto } from './dto/record-response.dto';
import { VoidRecordDto } from './dto/void-record.dto';
import {
  ClinicalRecordsRepository,
  RecordWithCount,
} from './repositories/clinical-records.repository';

@Injectable()
export class ClinicalRecordsService {
  constructor(
    private readonly repo: ClinicalRecordsRepository,
    private readonly prisma: PrismaService,
  ) {}

  async create(
    patientId: string,
    dto: CreateRecordDto,
    userId?: string,
  ): Promise<RecordResponseDto> {
    const record = await this.repo.create({
      patientId,
      recordType: dto.recordType,
      origin: dto.origin ?? RecordOrigin.MANUAL,
      attendedAt: new Date(dto.attendedAt),
      summary: dto.summary,
      notes: dto.notes ?? null,
      ...(dto.doctorName && { doctorName: dto.doctorName }),
      ...(dto.service && { service: dto.service }),
      ...(dto.preliminaryDiagnosis && { preliminaryDiagnosis: dto.preliminaryDiagnosis }),
      ...(dto.plan && { plan: dto.plan }),
      ...(dto.priority && { priority: dto.priority }),
      ...(userId && { createdBy: userId }),
    });
    return this.toResponse(record);
  }

  async findByPatient(
    patientId: string,
    query: FindRecordsQueryDto,
  ): Promise<{ data: RecordResponseDto[]; total: number; page: number; limit: number }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const from = query.from ? parseClinicalDateFilter(query.from, 'from') : undefined;
    const to = query.to ? parseClinicalDateFilter(query.to, 'to') : undefined;

    const { records, total } = await this.repo.findByPatient(patientId, {
      recordType: query.recordType,
      status: query.status,
      origin: query.origin,
      from: from?.date,
      to: to?.date,
      toExclusive: to?.exclusive,
      page,
      limit,
    });

    return { data: records.map(this.toResponse), total, page, limit };
  }

  async findOne(patientId: string, id: string): Promise<RecordResponseDto> {
    const record = await this.repo.findByIdAndPatient(id, patientId);
    if (!record) throw new NotFoundException('Historia clínica no encontrada.');
    return this.toResponse(record);
  }

  async correct(
    patientId: string,
    id: string,
    dto: CorrectRecordDto,
    userId?: string,
  ): Promise<RecordResponseDto> {
    const original = await this.repo.findByIdAndPatient(id, patientId);
    if (!original) throw new NotFoundException('Historia clínica no encontrada.');
    if (original.status !== RecordStatus.ACTIVE) {
      throw new ConflictException(
        `No se puede corregir un registro con estado ${original.status}.`,
      );
    }

    const newRecord = await this.prisma.$transaction(async (tx) => {
      await this.repo.markCorrected(id, userId, tx);
      return this.repo.createInTransaction(
        {
          patientId,
          recordType: original.recordType,
          origin: original.origin,
          attendedAt: dto.attendedAt ? new Date(dto.attendedAt) : original.attendedAt,
          summary: dto.summary,
          notes: dto.notes ?? null,
          // El contexto clínico se hereda del registro original.
          doctorName: original.doctorName,
          service: original.service,
          preliminaryDiagnosis: original.preliminaryDiagnosis,
          plan: original.plan,
          priority: original.priority,
          parentRecordId: id,
          ...(userId && { createdBy: userId }),
        },
        tx,
      );
    });

    return this.toResponse(newRecord);
  }

  async void(
    patientId: string,
    id: string,
    dto: VoidRecordDto,
    userId?: string,
  ): Promise<RecordResponseDto> {
    const record = await this.repo.findByIdAndPatient(id, patientId);
    if (!record) throw new NotFoundException('Historia clínica no encontrada.');
    if (record.status !== RecordStatus.ACTIVE) {
      throw new ConflictException(
        `No se puede anular un registro con estado ${record.status}.`,
      );
    }

    const voided = await this.repo.markVoided(id, dto.reason, userId);
    return this.toResponse({
      ...voided,
      _count: { corrections: record._count.corrections },
    });
  }

  private toResponse(record: RecordWithCount): RecordResponseDto {
    return {
      id: record.id,
      patientId: record.patientId,
      recordType: record.recordType,
      origin: record.origin,
      status: record.status,
      attendedAt: record.attendedAt,
      summary: record.summary,
      notes: record.notes,
      doctorName: record.doctorName,
      service: record.service,
      preliminaryDiagnosis: record.preliminaryDiagnosis,
      plan: record.plan,
      priority: record.priority,
      parentRecordId: record.parentRecordId,
      voidReason: record.voidReason,
      correctionsCount: record._count.corrections,
      createdAt: record.createdAt,
      createdBy: record.createdBy,
      updatedAt: record.updatedAt,
    };
  }
}
