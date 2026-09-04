import { randomUUID } from 'crypto';
import { extname } from 'path';
import { ReadStream } from 'fs';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  UnsupportedMediaTypeException,
  UnauthorizedException,
} from '@nestjs/common';
import { DocumentStatus, MedicalDocument, Prisma } from '@prisma/client';
import { IaClientService } from '../../core/ia/ia-client.service';
import { StorageService } from '../../core/storage/storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CorrectDocumentDto } from './dto/correct-document.dto';
import { DocumentResponseDto } from './dto/document-response.dto';
import { FindDocumentsQueryDto } from './dto/find-documents-query.dto';
import { RejectDocumentDto } from './dto/reject-document.dto';
import {
  createValidationChecklistSnapshot,
  REQUIRED_VALIDATION_CHECKLIST,
  ValidateDocumentDto,
  ValidationChecklistSnapshotDto,
} from './dto/validate-document.dto';
import {
  MedicalDocumentsRepository,
  type MedicalDocumentWithAssignee,
} from './repositories/medical-documents.repository';

const DEFAULT_UPLOAD_MAX_SIZE_MB = 20;
const ALLOWED_UPLOADS = new Map<string, Set<string>>([
  ['application/pdf', new Set(['.pdf'])],
  ['image/jpeg', new Set(['.jpg', '.jpeg'])],
  ['image/png', new Set(['.png'])],
]);
const PDF_SIGNATURE = Buffer.from('%PDF-', 'ascii');
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function detectUploadMime(buffer: Buffer): string | null {
  if (
    buffer.length >= PNG_SIGNATURE.length &&
    buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
  ) {
    return 'image/png';
  }
  if (
    buffer.length >= JPEG_SIGNATURE.length &&
    buffer.subarray(0, JPEG_SIGNATURE.length).equals(JPEG_SIGNATURE)
  ) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= PDF_SIGNATURE.length &&
    buffer.subarray(0, PDF_SIGNATURE.length).equals(PDF_SIGNATURE)
  ) {
    return 'application/pdf';
  }
  return null;
}

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

function normalizeCorrectedEntities(
  entities: CorrectDocumentDto['correctedEntities'],
): Array<{ type: string; value: string; normalizedValue: string | null }> {
  return (entities ?? [])
    .map((entity) => ({
      type: entity.type,
      value: entity.value.trim(),
      normalizedValue: entity.normalizedValue?.trim() || null,
    }))
    .filter((entity) => entity.value.length > 0);
}

function normalizeStoredEntities(
  entities: unknown,
): Array<{ type: string; value: string; normalizedValue: string | null }> {
  if (!Array.isArray(entities)) return [];

  return entities.flatMap((entity) => {
    if (!entity || typeof entity !== 'object' || Array.isArray(entity)) return [];
    const candidate = entity as Record<string, unknown>;
    if (typeof candidate.type !== 'string' || typeof candidate.value !== 'string') return [];

    return [{
      type: candidate.type,
      value: candidate.value.trim(),
      normalizedValue:
        typeof candidate.normalizedValue === 'string'
          ? candidate.normalizedValue.trim() || null
          : null,
    }];
  });
}

function requireAuthenticatedActor(userId: string): void {
  if (!userId) {
    throw new UnauthorizedException('No se pudo identificar al usuario autenticado.');
  }
}

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
export class MedicalDocumentsService implements OnModuleInit {
  private readonly logger = new Logger(MedicalDocumentsService.name);

  constructor(
    private readonly repo: MedicalDocumentsRepository,
    private readonly storage: StorageService,
    private readonly iaClient: IaClientService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Recuperación tras reinicio: los documentos que quedaron en PROCESSING
   * pertenecen a un OCR que murió con el proceso anterior — se marcan FAILED
   * para que puedan reintentarse desde la interfaz.
   */
  async onModuleInit(): Promise<void> {
    try {
      const recovered = await this.repo.failStaleProcessing();
      if (recovered > 0) {
        this.logger.warn(
          `${recovered} documento(s) quedaron en PROCESSING tras un reinicio — marcados FAILED para reintento.`,
        );
      }
    } catch (err) {
      this.logger.error(`No se pudo recuperar documentos PROCESSING: ${String(err)}`);
    }
  }

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
    const detectedMime = detectUploadMime(file.buffer);
    const allowedExtensions = detectedMime ? ALLOWED_UPLOADS.get(detectedMime) : undefined;
    if (!detectedMime || detectedMime !== file.mimetype || !allowedExtensions?.has(ext)) {
      throw new UnsupportedMediaTypeException(
        'Archivo no permitido. Adjunta un PDF, JPEG o PNG válido.',
      );
    }

    const filename = `${randomUUID()}${ext}`;
    let storagePath = `${patientId}/${filename}`;
    let doc: MedicalDocumentWithAssignee;
    try {
      storagePath = await this.storage.save(file.buffer, filename, patientId);
      doc = await this.repo.create({
        patientId,
        originalName: file.originalname,
        storagePath,
        mimeType: detectedMime,
        sizeBytes: file.size,
        ...(userId && { createdBy: userId }),
      });
    } catch (error) {
      await this.storage.delete(storagePath).catch(() => {
        this.logger.error('No se pudo retirar un archivo huérfano tras fallar su metadata.');
      });
      throw error;
    }

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

    const processing = await this.repo.updateStatus(id, DocumentStatus.PROCESSING, {
      ...(userId && { updatedBy: userId }),
    });

    // El OCR puede tardar minutos: se ejecuta en segundo plano y se notifica
    // al usuario al terminar. La respuesta vuelve de inmediato (PROCESSING).
    void this.runProcessing(doc, userId);

    return this.toResponse(processing);
  }

  private async runProcessing(doc: MedicalDocument, userId?: string): Promise<void> {
    const { id, patientId } = doc;
    try {
      const allowedMime = doc.mimeType as 'image/jpeg' | 'image/png' | 'application/pdf';
      const fileBytes = await this.storage.readFile(doc.storagePath);
      const result = await this.iaClient.process(id, fileBytes, allowedMime);

      await this.repo.updateStatus(id, DocumentStatus.PROCESSED, {
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

      if (userId) {
        await this.notifications.notify({
          userId,
          type: 'DOCUMENT_PROCESSED',
          title: 'Digitalización completada',
          body: `«${doc.originalName}» ya tiene texto OCR y está listo para corregir.`,
          patientId,
          documentId: id,
        });
      }
    } catch (err) {
      this.logger.error(`Error procesando documento ${id}: ${String(err)}`);
      await this.repo
        .updateStatus(id, DocumentStatus.FAILED, {
          ...(userId && { updatedBy: userId }),
        })
        .catch((updateErr) =>
          this.logger.error(`No se pudo marcar FAILED el documento ${id}: ${String(updateErr)}`),
        );

      if (userId) {
        await this.notifications.notify({
          userId,
          type: 'DOCUMENT_FAILED',
          title: 'Error en la digitalización',
          body: `«${doc.originalName}» no pudo procesarse. Puedes reintentar desde el documento.`,
          patientId,
          documentId: id,
        });
      }
    }
  }

  async validate(
    patientId: string,
    id: string,
    dto: ValidateDocumentDto,
    userId: string,
  ): Promise<DocumentResponseDto> {
    requireAuthenticatedActor(userId);
    const doc = await this.repo.findByIdAndPatient(id, patientId);
    if (!doc) throw new NotFoundException('Documento no encontrado.');
    if (doc.status !== DocumentStatus.PROCESSED) {
      throw new ConflictException(
        `Solo se puede validar un documento con estado PROCESSED. Estado actual: ${doc.status}.`,
      );
    }
    this.ensureAssignedToActor(doc, userId);

    const correctedText = dto.correctedText?.trim();
    if (!correctedText) {
      throw new BadRequestException('El texto final revisado no puede estar vacío.');
    }

    const checklist = new Set(dto.checklistItems);
    const hasCompleteChecklist =
      checklist.size === REQUIRED_VALIDATION_CHECKLIST.length &&
      REQUIRED_VALIDATION_CHECKLIST.every((item) => checklist.has(item));
    if (dto.attested !== true || !hasCompleteChecklist) {
      throw new BadRequestException(
        'Debe confirmar todos los puntos del checklist antes de validar.',
      );
    }

    const normalizedEntities = normalizeCorrectedEntities(dto.correctedEntities);
    const savedText = (doc.correctedText ?? doc.ocrText ?? '').trim();
    const savedEntities = normalizeStoredEntities(
      doc.correctedEntities ?? doc.nerEntities,
    );
    const contentChanged =
      correctedText !== savedText ||
      JSON.stringify(normalizedEntities) !== JSON.stringify(savedEntities);

    const now = new Date();
    const updated = await this.repo.validateWithCorrection(
      id,
      patientId,
      dto.expectedVersion,
      userId,
      {
        correctedText,
        correctedEntities: normalizedEntities as unknown as Prisma.InputJsonValue,
        ...(contentChanged && {
          correctedAt: now,
          correctedById: userId,
        }),
        reviewedAt: now,
        reviewedBy: userId,
        validationChecklist:
          createValidationChecklistSnapshot() as unknown as Prisma.InputJsonValue,
        validationAttestedAt: now,
        updatedBy: userId,
      },
    );
    if (!updated) {
      throw new ConflictException(
        'El documento cambió mientras lo revisabas. Recarga la versión actual antes de validar.',
      );
    }
    return this.toResponse(updated);
  }

  async saveCorrection(
    patientId: string,
    id: string,
    dto: CorrectDocumentDto,
    userId: string,
  ): Promise<DocumentResponseDto> {
    requireAuthenticatedActor(userId);
    const doc = await this.repo.findByIdAndPatient(id, patientId);
    if (!doc) throw new NotFoundException('Documento no encontrado.');
    if (doc.status !== DocumentStatus.PROCESSED) {
      throw new ConflictException(
        `Solo se puede corregir un documento con estado PROCESSED. Estado actual: ${doc.status}.`,
      );
    }
    this.ensureAssignedToActor(doc, userId);

    const hasCorrectedText = dto.correctedText !== undefined;
    const hasCorrectedEntities = dto.correctedEntities !== undefined;
    if (!hasCorrectedText && !hasCorrectedEntities) {
      throw new BadRequestException('Debe enviar texto corregido o entidades corregidas.');
    }

    const updated = await this.repo.saveCorrection(id, patientId, dto.expectedVersion, userId, {
      ...(hasCorrectedText && { correctedText: dto.correctedText?.trim() ?? null }),
      ...(hasCorrectedEntities && {
        correctedEntities: normalizeCorrectedEntities(dto.correctedEntities) as unknown as Prisma.InputJsonValue,
      }),
      correctedAt: new Date(),
      correctedById: userId,
      updatedBy: userId,
    });

    if (!updated) {
      throw new ConflictException(
        'El documento cambió mientras lo editabas. Recarga la versión actual antes de guardar.',
      );
    }

    return this.toResponse(updated);
  }

  async reject(
    patientId: string,
    id: string,
    dto: RejectDocumentDto,
    userId: string,
  ): Promise<DocumentResponseDto> {
    requireAuthenticatedActor(userId);
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
    if (doc.status === DocumentStatus.PROCESSED) {
      this.ensureAssignedToActor(doc, userId);
    }
    const rejectReason = dto.reason.trim();
    if (rejectReason.length < 10) {
      throw new BadRequestException('El motivo del rechazo debe tener al menos 10 caracteres.');
    }
    const updated = await this.repo.rejectReviewedVersion(
      id,
      patientId,
      dto.expectedVersion,
      userId,
      {
        rejectReason,
        reviewedAt: new Date(),
        reviewedBy: userId,
        updatedBy: userId,
      },
    );
    if (!updated) {
      throw new ConflictException(
        'El documento cambió mientras lo revisabas. Recarga la versión actual antes de rechazar.',
      );
    }
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

  private toResponse(doc: MedicalDocumentWithAssignee): DocumentResponseDto {
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
      validationChecklist:
        doc.validationChecklist as unknown as ValidationChecklistSnapshotDto | null,
      validationAttested: doc.validationAttested,
      validationAttestedAt: doc.validationAttestedAt,
      reviewPriority: doc.reviewPriority,
      assignedReviewerId: doc.assignedReviewerId,
      assignedAt: doc.assignedAt,
      assignedReviewer: doc.assignedReviewer,
      updatedAt: doc.updatedAt,
      version: doc.version,
    };
  }

  private ensureAssignedToActor(doc: MedicalDocument, actorId: string): void {
    if (!doc.assignedReviewerId) {
      throw new ConflictException(
        'El documento debe ser tomado o asignado antes de editar su revisión.',
      );
    }
    if (doc.assignedReviewerId !== actorId) {
      throw new ConflictException('El documento está asignado a otro revisor.');
    }
  }
}
