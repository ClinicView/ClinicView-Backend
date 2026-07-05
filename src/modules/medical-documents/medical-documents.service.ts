import { randomUUID } from 'crypto';
import { extname } from 'path';
import { ReadStream } from 'fs';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DocumentStatus, MedicalDocument, Prisma } from '@prisma/client';
import { IaClientService } from '../../core/ia/ia-client.service';
import { StorageService } from '../../core/storage/storage.service';
import { CorrectDocumentDto } from './dto/correct-document.dto';
import { DocumentResponseDto } from './dto/document-response.dto';
import { FindDocumentsQueryDto } from './dto/find-documents-query.dto';
import { RejectDocumentDto } from './dto/reject-document.dto';
import { MedicalDocumentsRepository } from './repositories/medical-documents.repository';

const DEFAULT_UPLOAD_MAX_SIZE_MB = 20;
const ALLOWED_UPLOADS = new Map<string, Set<string>>([
  ['application/pdf', new Set(['.pdf'])],
  ['image/jpeg', new Set(['.jpg', '.jpeg'])],
  ['image/png', new Set(['.png'])],
]);

function getUploadMaxSizeBytes(): number {
  const configured = Number.parseInt(
    process.env.UPLOAD_MAX_SIZE_MB ?? String(DEFAULT_UPLOAD_MAX_SIZE_MB),
    10,
  );
  const sizeMb = Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_UPLOAD_MAX_SIZE_MB;
  return sizeMb * 1024 * 1024;
}

const SNIPPET_CONTEXT_CHARS = 80;

/** Extrae un fragmento del texto alrededor de la primera coincidencia. */
function buildSnippet(text: string | null, keyword: string): string | null {
  if (!text) return null;
  const index = text.toLowerCase().indexOf(keyword.toLowerCase());
  if (index < 0) return null;
  const start = Math.max(0, index - SNIPPET_CONTEXT_CHARS);
  const end = Math.min(text.length, index + keyword.length + SNIPPET_CONTEXT_CHARS);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return `${prefix}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${suffix}`;
}

@Injectable()
export class MedicalDocumentsService {
  private readonly logger = new Logger(MedicalDocumentsService.name);

  constructor(
    private readonly repo: MedicalDocumentsRepository,
    private readonly storage: StorageService,
    private readonly iaClient: IaClientService,
  ) {}

  async upload(
    patientId: string,
    file: Express.Multer.File,
    userId?: string,
  ): Promise<DocumentResponseDto> {
    if (!file) {
      throw new BadRequestException('Archivo requerido.');
    }

    if (!(await this.repo.isPatientActive(patientId))) {
      throw new ConflictException(
        'El paciente está desactivado. Reactívalo antes de subir nuevos documentos.',
      );
    }

    const maxSizeBytes = getUploadMaxSizeBytes();
    if (file.size > maxSizeBytes) {
      throw new ConflictException(
        `Archivo demasiado grande. Máximo permitido: ${Math.floor(maxSizeBytes / 1024 / 1024)} MB.`,
      );
    }

    const ext = extname(file.originalname).toLowerCase();
    const allowedExtensions = ALLOWED_UPLOADS.get(file.mimetype);
    if (!allowedExtensions?.has(ext)) {
      throw new ConflictException(
        'Tipo de archivo no permitido. Permitidos: PDF, JPEG y PNG con extensión válida.',
      );
    }

    const filename = `${randomUUID()}${ext}`;
    const storagePath = await this.storage.save(file.buffer, filename, patientId);

    const doc = await this.repo.create({
      patientId,
      originalName: file.originalname,
      storagePath,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      ...(userId && { createdBy: userId }),
    });

    return this.toResponse(doc);
  }

  async findByPatient(
    patientId: string,
    query: FindDocumentsQueryDto,
  ): Promise<{ data: DocumentResponseDto[]; total: number; page: number; limit: number }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { documents, total } = await this.repo.findByPatient(patientId, {
      status: query.status,
      page,
      limit,
    });
    return { data: documents.map(this.toResponse), total, page, limit };
  }

  async findOne(patientId: string, id: string): Promise<DocumentResponseDto> {
    const doc = await this.repo.findByIdAndPatient(id, patientId);
    if (!doc) throw new NotFoundException('Documento no encontrado.');
    return this.toResponse(doc);
  }

  async getFile(
    patientId: string,
    id: string,
  ): Promise<{ document: MedicalDocument; stream: ReadStream }> {
    const doc = await this.repo.findByIdAndPatient(id, patientId);
    if (!doc) throw new NotFoundException('Documento no encontrado.');
    const stream = this.storage.createReadStream(doc.storagePath);
    return { document: doc, stream };
  }

  async process(patientId: string, id: string, userId?: string): Promise<DocumentResponseDto> {
    const doc = await this.repo.findByIdAndPatient(id, patientId);
    if (!doc) throw new NotFoundException('Documento no encontrado.');
    if (!(await this.repo.isPatientActive(patientId))) {
      throw new ConflictException(
        'El paciente está desactivado. Reactívalo antes de procesar documentos.',
      );
    }
    if (doc.status !== DocumentStatus.PENDING && doc.status !== DocumentStatus.FAILED) {
      throw new ConflictException(
        `No se puede procesar un documento con estado ${doc.status}.`,
      );
    }

    await this.repo.updateStatus(id, DocumentStatus.PROCESSING, {
      ...(userId && { updatedBy: userId }),
    });

    try {
      const allowedMime = doc.mimeType as 'image/jpeg' | 'image/png' | 'application/pdf';
      const fileBytes = await this.storage.readFile(doc.storagePath);
      const result = await this.iaClient.process(doc.id, fileBytes, allowedMime);

      const updated = await this.repo.updateStatus(id, DocumentStatus.PROCESSED, {
        ocrText: result.ocrText,
        nerEntities: result.entities as unknown as Prisma.InputJsonValue,
        ...(result.metrics && {
          metrics: result.metrics as unknown as Prisma.InputJsonValue,
        }),
        ocrConfidence: result.ocrConfidence,
        confidenceLevel: result.confidenceLevel,
        processedAt: new Date(),
        ...(userId && { updatedBy: userId }),
      });

      return this.toResponse(updated);
    } catch (err) {
      this.logger.error(`Error procesando documento ${id}: ${String(err)}`);
      const failed = await this.repo.updateStatus(id, DocumentStatus.FAILED, {
        ...(userId && { updatedBy: userId }),
      });
      return this.toResponse(failed);
    }
  }

  async validate(patientId: string, id: string, userId?: string): Promise<DocumentResponseDto> {
    const doc = await this.repo.findByIdAndPatient(id, patientId);
    if (!doc) throw new NotFoundException('Documento no encontrado.');
    if (doc.status !== DocumentStatus.PROCESSED) {
      throw new ConflictException(
        `Solo se puede validar un documento con estado PROCESSED. Estado actual: ${doc.status}.`,
      );
    }
    const updated = await this.repo.updateStatus(id, DocumentStatus.VALIDATED, {
      reviewedAt: new Date(),
      ...(userId && { reviewedBy: userId, updatedBy: userId }),
    });
    return this.toResponse(updated);
  }

  async saveCorrection(
    patientId: string,
    id: string,
    dto: CorrectDocumentDto,
    userId?: string,
  ): Promise<DocumentResponseDto> {
    const doc = await this.repo.findByIdAndPatient(id, patientId);
    if (!doc) throw new NotFoundException('Documento no encontrado.');
    if (doc.status !== DocumentStatus.PROCESSED) {
      throw new ConflictException(
        `Solo se puede corregir un documento con estado PROCESSED. Estado actual: ${doc.status}.`,
      );
    }

    const hasCorrectedText = dto.correctedText !== undefined;
    const hasCorrectedEntities = dto.correctedEntities !== undefined;
    if (!hasCorrectedText && !hasCorrectedEntities) {
      throw new BadRequestException('Debe enviar texto corregido o entidades corregidas.');
    }

    const updated = await this.repo.saveCorrection(id, {
      ...(hasCorrectedText && { correctedText: dto.correctedText?.trim() ?? null }),
      ...(hasCorrectedEntities && {
        correctedEntities: (dto.correctedEntities ?? []) as unknown as Prisma.InputJsonValue,
      }),
      correctedAt: new Date(),
      ...(userId && { correctedById: userId, updatedBy: userId }),
    });

    return this.toResponse(updated);
  }

  async reject(
    patientId: string,
    id: string,
    dto: RejectDocumentDto,
    userId?: string,
  ): Promise<DocumentResponseDto> {
    const doc = await this.repo.findByIdAndPatient(id, patientId);
    if (!doc) throw new NotFoundException('Documento no encontrado.');
    if (
      doc.status !== DocumentStatus.PROCESSED &&
      doc.status !== DocumentStatus.PENDING
    ) {
      throw new ConflictException(
        `No se puede rechazar un documento con estado ${doc.status}.`,
      );
    }
    const updated = await this.repo.updateStatus(id, DocumentStatus.REJECTED, {
      rejectReason: dto.reason,
      reviewedAt: new Date(),
      ...(userId && { reviewedBy: userId, updatedBy: userId }),
    });
    return this.toResponse(updated);
  }

  async searchByKeyword(
    patientId: string,
    keyword: string,
    page = 1,
    limit = 20,
  ): Promise<{
    data: Array<DocumentResponseDto & { snippet: string | null }>;
    total: number;
    page: number;
    limit: number;
  }> {
    const query = keyword.trim();
    if (query.length < 2) {
      throw new BadRequestException('El término de búsqueda debe tener al menos 2 caracteres.');
    }

    const { documents, total } = await this.repo.searchByPatient(patientId, query, page, limit);
    return {
      data: documents.map((doc) => ({
        ...this.toResponse(doc),
        snippet: buildSnippet(doc.correctedText ?? doc.ocrText, query),
      })),
      total,
      page,
      limit,
    };
  }

  private toResponse(doc: MedicalDocument): DocumentResponseDto {
    return {
      id: doc.id,
      patientId: doc.patientId,
      originalName: doc.originalName,
      mimeType: doc.mimeType,
      sizeBytes: doc.sizeBytes,
      status: doc.status,
      ocrText: doc.ocrText,
      nerEntities: doc.nerEntities,
      correctedText: doc.correctedText,
      correctedEntities: doc.correctedEntities,
      correctedAt: doc.correctedAt,
      correctedById: doc.correctedById,
      rejectReason: doc.rejectReason,
      metrics: doc.metrics,
      ocrConfidence: doc.ocrConfidence,
      confidenceLevel: doc.confidenceLevel,
      createdAt: doc.createdAt,
      createdBy: doc.createdBy,
      processedAt: doc.processedAt,
      reviewedAt: doc.reviewedAt,
      reviewedBy: doc.reviewedBy,
      updatedAt: doc.updatedAt,
    };
  }
}
