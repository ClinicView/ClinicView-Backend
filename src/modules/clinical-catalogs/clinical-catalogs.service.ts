import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { CatalogQueryDto, CreateCatalogEntryDto, UpdateCatalogEntryDto } from './catalog.dto';
export function normalizedCatalogName(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}
function conflict(error: unknown): never {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    ['P2002', 'P2025', 'P2034'].includes(String(error.code))
  )
    throw new ConflictException(
      'El código/nombre ya existe o cambió su versión. Revisa el catálogo y recarga.',
    );
  throw error;
}
@Injectable()
export class ClinicalCatalogsService {
  constructor(private readonly prisma: PrismaService) {}
  async list(query: CatalogQueryDto) {
    const where: Prisma.ClinicalCatalogEntryWhereInput = {
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.status === 'ALL' ? {} : { isActive: query.status !== 'INACTIVE' }),
      ...(query.q
        ? {
            OR: [
              { normalizedName: { contains: normalizedCatalogName(query.q) } },
              { code: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const page = query.page ?? 1;
    const limit = 20;
    const [data, total] = await this.prisma.$transaction(
      [
        this.prisma.clinicalCatalogEntry.findMany({
          where,
          orderBy: [{ normalizedName: 'asc' }, { id: 'asc' }],
          skip: (page - 1) * limit,
          take: limit,
        }),
        this.prisma.clinicalCatalogEntry.count({ where }),
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    return { data, total, page, limit };
  }
  create(dto: CreateCatalogEntryDto, actorId: string) {
    return this.prisma.clinicalCatalogEntry
      .create({
        data: {
          kind: dto.kind,
          code: dto.code,
          name: dto.name,
          normalizedName: normalizedCatalogName(dto.name),
          updatedBy: actorId,
        },
      })
      .catch(conflict);
  }
  async update(id: string, dto: UpdateCatalogEntryDto, actorId: string) {
    const original = await this.prisma.clinicalCatalogEntry.findUnique({ where: { id } });
    if (!original) throw new NotFoundException('Entrada de catálogo no encontrada.');
    return this.prisma.clinicalCatalogEntry
      .update({
        where: { id, version: dto.expectedVersion },
        data: {
          name: dto.name,
          normalizedName: normalizedCatalogName(dto.name),
          isActive: dto.isActive,
          updatedBy: actorId,
          version: { increment: 1 },
        },
      })
      .catch(conflict);
  }
}
