import { createHash, randomBytes } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
  UnauthorizedException,
} from '@nestjs/common';
import { ClinicalMediaAsset, ClinicalMediaStatus, Prisma } from '@prisma/client';
// sharp publica su factory CommonJS mediante `export =`; este import preserva
// el callable real sin activar esModuleInterop para todo el proyecto.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import sharpModule = require('sharp');
import type { Metadata, SharpConstructor } from 'sharp';
import { StorageService } from '../../core/storage/storage.service';
import { PrismaService } from '../../database/prisma.service';
import {
  ClinicalMediaAssetResponseDto,
  buildClinicalMediaContentUrl,
  MAX_ATTACHMENT_ALT_TEXT_LENGTH,
  MAX_ATTACHMENT_CAPTION_LENGTH,
  MAX_ATTACHMENT_SECTION_KEY_LENGTH,
  MAX_RECORD_ATTACHMENTS,
  MAX_RECORD_ATTACHMENTS_BYTES,
  RecordAttachmentInputDto,
} from './dto/record-attachment.dto';
import { ClinicalRecordMediaRepository } from './repositories/clinical-record-media.repository';

export const MAX_RECORD_MEDIA_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_RECORD_MEDIA_PIXELS = 25_000_000;
export const MAX_RECORD_MEDIA_DIMENSION = 10_000;
export const RECORD_MEDIA_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const PURGE_INTERVAL_MS = 60 * 60 * 1000;
const PURGE_BATCH_SIZE = 100;
const RECORD_MEDIA_SUBDIR = 'record-media';
const SECTION_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const sharp = sharpModule as unknown as SharpConstructor;

type SupportedImageFormat = 'jpeg' | 'png';

export interface AttachmentBindingInput {
  assetId: string;
  sectionKey?: string | null;
  caption?: string | null;
  altText?: string | null;
  sortOrder?: number;
}

interface NormalizedImage {
  buffer: Buffer;
  mimeType: 'image/jpeg' | 'image/png';
  extension: '.jpg' | '.png';
  width: number;
  height: number;
  sha256: string;
}

interface BoundAttachmentsSummary {
  count: number;
  assetIds: string[];
}

function optionalText(value: string | null | undefined): string | null {
  if (value == null) return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function sanitizeOriginalName(value: string | undefined): string {
  const basename = (value ?? '').split(/[\\/]/).pop() ?? '';
  const normalized = basename
    .replace(/\p{Cc}/gu, '')
    .trim()
    .slice(0, 240);
  return normalized || 'imagen-clinica';
}

function canonicalDownloadName(originalName: string, mimeType: string): string {
  const extension = mimeType === 'image/png' ? '.png' : '.jpg';
  const stem =
    originalName
      .replace(/\.[^.]*$/, '')
      .trim()
      .slice(0, 180) || 'imagen-clinica';
  return `${stem}${extension}`;
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT',
  );
}

function isTransactionConflict(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2034',
  );
}

function isAnimatedPng(buffer: Buffer): boolean {
  if (buffer.length < PNG_SIGNATURE.length || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return false;
  }

  let offset = PNG_SIGNATURE.length;
  while (offset + 12 <= buffer.length) {
    const dataLength = buffer.readUInt32BE(offset);
    const chunkEnd = offset + 12 + dataLength;
    if (chunkEnd > buffer.length) return false;

    const chunkType = buffer.toString('ascii', offset + 4, offset + 8);
    if (chunkType === 'acTL') return true;
    if (chunkType === 'IEND') return false;
    offset = chunkEnd;
  }

  return false;
}

function safeErrorMetadata(error: unknown): { errorName: string; errorCode: string | null } {
  if (!error || typeof error !== 'object') {
    return { errorName: 'UnknownError', errorCode: null };
  }
  const candidate = error as { name?: unknown; code?: unknown };
  return {
    errorName: typeof candidate.name === 'string' ? candidate.name.slice(0, 80) : 'Error',
    errorCode: typeof candidate.code === 'string' ? candidate.code.slice(0, 40) : null,
  };
}

@Injectable()
export class ClinicalRecordMediaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ClinicalRecordMediaService.name);
  private purgeTimer?: NodeJS.Timeout;
  private purgeInFlight?: Promise<number>;

  constructor(
    private readonly repo: ClinicalRecordMediaRepository,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  onModuleInit(): void {
    void this.purgeExpiredTemporaryAssets().catch((error: unknown) => {
      this.logger.error(
        JSON.stringify({ event: 'clinical_media_purge_cycle_failed', ...safeErrorMetadata(error) }),
      );
    });
    this.purgeTimer = setInterval(() => {
      void this.purgeExpiredTemporaryAssets().catch((error: unknown) => {
        this.logger.error(
          JSON.stringify({
            event: 'clinical_media_purge_cycle_failed',
            ...safeErrorMetadata(error),
          }),
        );
      });
    }, PURGE_INTERVAL_MS);
    this.purgeTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.purgeTimer) clearInterval(this.purgeTimer);
  }

  async upload(
    patientId: string,
    file: Express.Multer.File | undefined,
    actorId: string,
  ): Promise<ClinicalMediaAssetResponseDto> {
    this.requireActor(actorId);
    if (!file?.buffer?.length) throw new BadRequestException('Debes seleccionar una imagen.');
    if (file.buffer.length > MAX_RECORD_MEDIA_FILE_BYTES) {
      throw new PayloadTooLargeException('La imagen supera el máximo permitido de 10 MiB.');
    }

    const patientIsActive = await this.repo.isPatientActive(patientId);
    if (patientIsActive === null) throw new NotFoundException('Paciente no encontrado.');
    if (!patientIsActive) {
      throw new ConflictException(
        'El paciente está desactivado. Reactívalo antes de adjuntar imágenes.',
      );
    }

    const image = await this.normalizeImage(file.buffer);
    const filename = `${randomBytes(24).toString('hex')}${image.extension}`;
    const subdir = `${RECORD_MEDIA_SUBDIR}/${patientId}`;
    let storagePath = `${subdir}/${filename}`;

    let asset: ClinicalMediaAsset;
    try {
      asset = await this.prisma.$transaction(
        async (tx) => {
          const now = new Date();
          const quota = await this.repo.getTemporaryQuota(patientId, actorId, now, tx);
          if (quota.count >= MAX_RECORD_ATTACHMENTS) {
            throw new ConflictException(
              `Ya tienes ${MAX_RECORD_ATTACHMENTS} imágenes temporales para este paciente. Utilízalas o elimínalas antes de subir otra.`,
            );
          }
          if (quota.sizeBytes + image.buffer.length > MAX_RECORD_ATTACHMENTS_BYTES) {
            throw new PayloadTooLargeException(
              'Las imágenes temporales del paciente superarían el máximo agregado de 30 MiB.',
            );
          }

          storagePath = await this.storage.save(image.buffer, filename, subdir);
          return this.repo.create(
            {
              patientId,
              uploadedBy: actorId,
              originalName: sanitizeOriginalName(file.originalname),
              storagePath,
              mimeType: image.mimeType,
              sizeBytes: image.buffer.length,
              width: image.width,
              height: image.height,
              sha256: image.sha256,
              status: ClinicalMediaStatus.TEMPORARY,
              expiresAt: new Date(now.getTime() + RECORD_MEDIA_TTL_MS),
            },
            tx,
          );
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      await this.storage.delete(storagePath).catch(() => undefined);
      if (isTransactionConflict(error)) {
        throw new ConflictException('Otra carga cambió la cuota de imágenes. Intenta nuevamente.');
      }
      throw error;
    }

    this.audit('clinical_media_uploaded', actorId, patientId, asset, {
      declaredMimeMatched: file.mimetype === image.mimeType,
    });
    return this.toAssetResponse(asset);
  }

  async getContent(
    patientId: string,
    assetId: string,
    actorId: string,
  ): Promise<{ asset: ClinicalMediaAsset; content: Buffer; filename: string }> {
    const asset = await this.findAccessibleAsset(patientId, assetId, actorId);

    try {
      const content = await this.storage.readFile(asset.storagePath);
      return {
        asset,
        content,
        filename: canonicalDownloadName(asset.originalName, asset.mimeType),
      };
    } catch (error) {
      if (isMissingFileError(error)) {
        this.logger.error(
          JSON.stringify({
            event: 'clinical_media_content_missing',
            patientId,
            assetId,
            status: asset.status,
          }),
        );
        throw new NotFoundException('El contenido de la imagen clínica no está disponible.');
      }
      throw error;
    }
  }

  async getMetadata(
    patientId: string,
    assetId: string,
    actorId: string,
  ): Promise<ClinicalMediaAssetResponseDto> {
    const asset = await this.findAccessibleAsset(patientId, assetId, actorId);
    return this.toAssetResponse(asset);
  }

  async deleteTemporary(
    patientId: string,
    assetId: string,
    expectedVersion: number,
    actorId: string,
  ): Promise<void> {
    this.requireActor(actorId);
    const asset = await this.repo.findByIdAndPatient(assetId, patientId);
    if (!asset || asset.uploadedBy !== actorId) {
      throw new NotFoundException('Imagen clínica temporal no encontrada.');
    }
    if (asset.status !== ClinicalMediaStatus.TEMPORARY) {
      throw new ConflictException(
        'Una imagen ya adjunta a la historia clínica no se puede eliminar.',
      );
    }
    if (asset.version !== expectedVersion) {
      throw new ConflictException(
        'La imagen cambió desde que fue abierta. Recarga antes de eliminarla.',
      );
    }

    const deleted = await this.prisma.$transaction((tx) => this.repo.deleteTemporaryCas(asset, tx));
    if (!deleted) {
      throw new ConflictException(
        'La imagen cambió o fue utilizada por otro registro. Recarga antes de eliminarla.',
      );
    }
    await this.deleteStoredFileAfterMetadata(asset);

    this.audit('clinical_media_deleted', actorId, patientId, asset);
  }

  async validateDraftAttachments(
    patientId: string,
    actorId: string,
    attachments: RecordAttachmentInputDto[] | undefined,
    expiresAt: Date,
    tx: Prisma.TransactionClient,
  ): Promise<RecordAttachmentInputDto[]> {
    const normalized = this.normalizeAttachmentInputs(attachments ?? []);
    const assets = await this.resolveAttachableAssets(
      patientId,
      actorId,
      normalized,
      new Set(),
      tx,
    );
    const extended = await this.repo.extendTemporaryExpiry(
      assets.map(({ id }) => id),
      patientId,
      actorId,
      new Date(),
      expiresAt,
      tx,
    );
    if (!extended) {
      throw new ConflictException(
        'Uno o más adjuntos expiraron mientras se guardaba el borrador. Recarga antes de continuar.',
      );
    }
    return normalized;
  }

  async bindAttachments(
    patientId: string,
    clinicalRecordId: string,
    actorId: string,
    attachments: AttachmentBindingInput[],
    reusableAssetIds: ReadonlySet<string>,
    tx: Prisma.TransactionClient,
  ): Promise<BoundAttachmentsSummary> {
    this.requireActor(actorId);
    const normalized = this.normalizeAttachmentInputs(attachments);
    if (normalized.length === 0) return { count: 0, assetIds: [] };

    const assets = await this.resolveAttachableAssets(
      patientId,
      actorId,
      normalized,
      reusableAssetIds,
      tx,
    );
    const temporaryIds = assets
      .filter((asset) => asset.status === ClinicalMediaStatus.TEMPORARY)
      .map((asset) => asset.id);
    const transitioned = await this.repo.transitionTemporaryToAttached(
      temporaryIds,
      patientId,
      actorId,
      new Date(),
      tx,
    );
    if (!transitioned) {
      throw new ConflictException(
        'Uno o más adjuntos expiraron o fueron utilizados en otra operación. Recarga antes de guardar.',
      );
    }

    await this.repo.createAttachments(
      normalized.map((attachment, index) => ({
        clinicalRecordId,
        assetId: attachment.assetId,
        sectionKey: attachment.sectionKey,
        caption: attachment.caption,
        altText: attachment.altText,
        sortOrder: attachment.sortOrder ?? index,
        createdBy: actorId,
      })),
      tx,
    );

    return { count: normalized.length, assetIds: normalized.map(({ assetId }) => assetId) };
  }

  logBoundAttachments(
    actorId: string,
    patientId: string,
    clinicalRecordId: string,
    summary: BoundAttachmentsSummary,
  ): void {
    if (summary.count === 0) return;
    this.logger.log(
      JSON.stringify({
        event: 'clinical_media_bound',
        actorId,
        patientId,
        clinicalRecordId,
        attachmentCount: summary.count,
        assetIds: summary.assetIds,
      }),
    );
  }

  async purgeExpiredTemporaryAssets(): Promise<number> {
    if (this.purgeInFlight) return this.purgeInFlight;
    this.purgeInFlight = this.runPurge().finally(() => {
      this.purgeInFlight = undefined;
    });
    return this.purgeInFlight;
  }

  toAssetResponse(asset: ClinicalMediaAsset): ClinicalMediaAssetResponseDto {
    return {
      id: asset.id,
      patientId: asset.patientId,
      originalName: asset.originalName,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
      width: asset.width,
      height: asset.height,
      sha256: asset.sha256,
      status: asset.status,
      expiresAt: asset.expiresAt,
      version: asset.version,
      createdAt: asset.createdAt,
      updatedAt: asset.updatedAt,
      contentUrl: buildClinicalMediaContentUrl(asset.patientId, asset.id),
    };
  }

  private async normalizeImage(buffer: Buffer): Promise<NormalizedImage> {
    // libvips puede abrir solo el primer fotograma de ciertos APNG. Detectar el
    // chunk de control evita aceptar silenciosamente una imagen animada.
    if (isAnimatedPng(buffer)) {
      throw new UnsupportedMediaTypeException(
        'No se permiten imágenes animadas o multipágina; adjunta un JPEG o PNG estático.',
      );
    }

    let metadata: Metadata;
    try {
      metadata = await sharp(buffer, {
        failOn: 'warning',
        limitInputPixels: MAX_RECORD_MEDIA_PIXELS,
        sequentialRead: true,
      }).metadata();
    } catch {
      throw new BadRequestException(
        'La imagen está dañada, no es válida o supera el límite de 25 megapíxeles.',
      );
    }

    if (metadata.format !== 'jpeg' && metadata.format !== 'png') {
      throw new UnsupportedMediaTypeException('Solo se permiten imágenes JPEG o PNG reales.');
    }
    if ((metadata.pages ?? 1) > 1) {
      throw new UnsupportedMediaTypeException(
        'No se permiten imágenes animadas o multipágina; adjunta un JPEG o PNG estático.',
      );
    }
    if (!metadata.width || !metadata.height) {
      throw new BadRequestException('No se pudieron determinar las dimensiones de la imagen.');
    }
    if (
      metadata.width > MAX_RECORD_MEDIA_DIMENSION ||
      metadata.height > MAX_RECORD_MEDIA_DIMENSION ||
      metadata.width * metadata.height > MAX_RECORD_MEDIA_PIXELS
    ) {
      throw new BadRequestException(
        'La imagen supera las dimensiones permitidas (10 000 px por lado y 25 MP).',
      );
    }

    const format = metadata.format as SupportedImageFormat;
    let output: Buffer;
    try {
      const pipeline = sharp(buffer, {
        failOn: 'warning',
        limitInputPixels: MAX_RECORD_MEDIA_PIXELS,
        sequentialRead: true,
      }).rotate();
      output =
        format === 'jpeg'
          ? await pipeline.jpeg({ quality: 90, mozjpeg: true }).toBuffer()
          : await pipeline.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
    } catch {
      throw new BadRequestException('No se pudo normalizar la imagen clínica.');
    }

    if (output.length > MAX_RECORD_MEDIA_FILE_BYTES) {
      throw new PayloadTooLargeException(
        'La imagen normalizada supera el máximo permitido de 10 MiB.',
      );
    }
    const normalizedMetadata = await sharp(output, {
      limitInputPixels: MAX_RECORD_MEDIA_PIXELS,
    }).metadata();
    if (!normalizedMetadata.width || !normalizedMetadata.height) {
      throw new BadRequestException('No se pudieron validar las dimensiones normalizadas.');
    }

    return {
      buffer: output,
      mimeType: format === 'jpeg' ? 'image/jpeg' : 'image/png',
      extension: format === 'jpeg' ? '.jpg' : '.png',
      width: normalizedMetadata.width,
      height: normalizedMetadata.height,
      sha256: createHash('sha256').update(output).digest('hex'),
    };
  }

  private normalizeAttachmentInputs(
    attachments: AttachmentBindingInput[],
  ): RecordAttachmentInputDto[] {
    if (!Array.isArray(attachments))
      throw new BadRequestException('attachments debe ser un arreglo.');
    if (attachments.length > MAX_RECORD_ATTACHMENTS) {
      throw new BadRequestException(
        `Solo se permiten ${MAX_RECORD_ATTACHMENTS} adjuntos por registro.`,
      );
    }

    const seen = new Set<string>();
    return attachments.map((attachment, index) => {
      if (!attachment || typeof attachment.assetId !== 'string' || !attachment.assetId.trim()) {
        throw new BadRequestException(`attachments.${index}.assetId es obligatorio.`);
      }
      const assetId = attachment.assetId.trim();
      if (seen.has(assetId)) {
        throw new BadRequestException('No se puede adjuntar la misma imagen más de una vez.');
      }
      seen.add(assetId);

      const sectionKey = optionalText(attachment.sectionKey);
      const caption = optionalText(attachment.caption);
      const altText = optionalText(attachment.altText);
      const sortOrder = attachment.sortOrder ?? index;
      if (sectionKey && !SECTION_KEY_PATTERN.test(sectionKey)) {
        throw new BadRequestException(
          `attachments.${index}.sectionKey debe ser una clave estable de hasta ${MAX_ATTACHMENT_SECTION_KEY_LENGTH} caracteres.`,
        );
      }
      if (caption && caption.length > MAX_ATTACHMENT_CAPTION_LENGTH) {
        throw new BadRequestException(
          `attachments.${index}.caption supera ${MAX_ATTACHMENT_CAPTION_LENGTH} caracteres.`,
        );
      }
      if (altText && altText.length > MAX_ATTACHMENT_ALT_TEXT_LENGTH) {
        throw new BadRequestException(
          `attachments.${index}.altText supera ${MAX_ATTACHMENT_ALT_TEXT_LENGTH} caracteres.`,
        );
      }
      if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder >= MAX_RECORD_ATTACHMENTS) {
        throw new BadRequestException(
          `attachments.${index}.sortOrder debe estar entre 0 y ${MAX_RECORD_ATTACHMENTS - 1}.`,
        );
      }

      return {
        assetId,
        sectionKey: sectionKey ?? undefined,
        caption: caption ?? undefined,
        altText: altText ?? undefined,
        sortOrder,
      };
    });
  }

  private async resolveAttachableAssets(
    patientId: string,
    actorId: string,
    attachments: RecordAttachmentInputDto[],
    reusableAssetIds: ReadonlySet<string>,
    tx: Prisma.TransactionClient,
  ): Promise<ClinicalMediaAsset[]> {
    this.requireActor(actorId);
    if (attachments.length === 0) return [];
    const ids = attachments.map(({ assetId }) => assetId);
    const assets = await this.repo.findManyByIdsAndPatient(ids, patientId, tx);
    if (assets.length !== ids.length) {
      throw new BadRequestException('Uno o más adjuntos no pertenecen al paciente o no existen.');
    }

    const now = new Date();
    for (const asset of assets) {
      if (asset.status === ClinicalMediaStatus.TEMPORARY) {
        if (asset.uploadedBy !== actorId || !asset.expiresAt || asset.expiresAt <= now) {
          throw new ConflictException(
            'Uno o más adjuntos temporales expiraron o pertenecen a otro usuario.',
          );
        }
      } else if (!reusableAssetIds.has(asset.id)) {
        throw new ConflictException(
          'Una imagen ya adjunta solo puede reutilizarse desde el registro que se está corrigiendo.',
        );
      }
    }

    const totalBytes = assets.reduce((sum, asset) => sum + asset.sizeBytes, 0);
    if (totalBytes > MAX_RECORD_ATTACHMENTS_BYTES) {
      throw new PayloadTooLargeException(
        'Los adjuntos del registro superan el máximo agregado de 30 MiB.',
      );
    }
    return assets;
  }

  private async runPurge(): Promise<number> {
    const expired = await this.repo.findExpiredTemporary(PURGE_BATCH_SIZE);
    let purged = 0;
    for (const asset of expired) {
      try {
        const removed = await this.prisma.$transaction((tx) =>
          this.repo.deleteTemporaryCas(asset, tx, new Date()),
        );
        if (removed) {
          await this.deleteStoredFileAfterMetadata(asset);
          purged += 1;
        }
      } catch (error) {
        this.logger.error(
          JSON.stringify({
            event: 'clinical_media_purge_failed',
            patientId: asset.patientId,
            assetId: asset.id,
            ...safeErrorMetadata(error),
          }),
        );
      }
    }
    if (purged > 0) {
      this.logger.log(JSON.stringify({ event: 'clinical_media_purged', count: purged }));
    }
    return purged;
  }

  private async findAccessibleAsset(
    patientId: string,
    assetId: string,
    actorId: string,
  ): Promise<ClinicalMediaAsset> {
    this.requireActor(actorId);
    const asset = await this.repo.findByIdAndPatient(assetId, patientId);
    if (!asset) throw new NotFoundException('Imagen clínica no encontrada.');
    if (asset.status === ClinicalMediaStatus.TEMPORARY) {
      const expired = !asset.expiresAt || asset.expiresAt <= new Date();
      if (asset.uploadedBy !== actorId || expired) {
        if (expired) void this.purgeExpiredTemporaryAssets().catch(() => undefined);
        throw new NotFoundException('Imagen clínica no encontrada.');
      }
    }
    return asset;
  }

  private audit(
    event: string,
    actorId: string,
    patientId: string,
    asset: ClinicalMediaAsset,
    extra: Record<string, unknown> = {},
  ): void {
    this.logger.log(
      JSON.stringify({
        event,
        actorId,
        patientId,
        assetId: asset.id,
        mimeType: asset.mimeType,
        sizeBytes: asset.sizeBytes,
        width: asset.width,
        height: asset.height,
        ...extra,
      }),
    );
  }

  private async deleteStoredFileAfterMetadata(asset: ClinicalMediaAsset): Promise<void> {
    try {
      await this.storage.delete(asset.storagePath);
    } catch (error) {
      // La fila ya no existe y por tanto el archivo no es accesible. Se registra
      // solo metadata para que operaciones pueda retirar el huérfano del storage.
      this.logger.error(
        JSON.stringify({
          event: 'clinical_media_storage_cleanup_failed',
          patientId: asset.patientId,
          assetId: asset.id,
          ...safeErrorMetadata(error),
        }),
      );
    }
  }

  private requireActor(actorId: string): void {
    if (!actorId?.trim()) {
      throw new UnauthorizedException('No se pudo identificar al usuario autenticado.');
    }
  }
}
