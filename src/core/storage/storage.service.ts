import { constants, createReadStream, mkdirSync, ReadStream } from 'fs';
import { access, readFile, stat, statfs, unlink, writeFile } from 'fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'path';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class StorageService implements OnModuleInit {
  private uploadDir: string;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    this.uploadDir = resolve(this.configService.get<string>('storage.uploadDir', './uploads'));
    mkdirSync(this.uploadDir, { recursive: true });
  }

  async save(buffer: Buffer, filename: string, subdir?: string): Promise<string> {
    const relativePath = subdir ? `${subdir}/${filename}` : filename;
    const absolutePath = this.resolvePrivatePath(relativePath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, buffer);
    return relativePath;
  }

  /** Read-only readiness: directory, access permissions and nonzero free capacity. */
  async checkReady(): Promise<void> {
    const metadata = await stat(this.uploadDir);
    if (!metadata.isDirectory()) throw new Error('Private storage unavailable.');
    await access(this.uploadDir, constants.R_OK | constants.W_OK);
    const capacity = await statfs(this.uploadDir);
    if (capacity.bavail <= 0) throw new Error('Private storage unavailable.');
  }

  createReadStream(relativePath: string): ReadStream {
    return createReadStream(this.resolvePrivatePath(relativePath));
  }

  async readFile(relativePath: string): Promise<Buffer> {
    return readFile(this.resolvePrivatePath(relativePath));
  }

  async delete(relativePath: string): Promise<void> {
    try {
      await unlink(this.resolvePrivatePath(relativePath));
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        (error as NodeJS.ErrnoException).code === 'ENOENT'
      ) {
        // El borrado es idempotente: un archivo ausente ya está eliminado.
        return;
      }
      throw error;
    }
  }

  private resolvePrivatePath(relativePath: string): string {
    const absolutePath = resolve(this.uploadDir, relativePath);
    const fromRoot = relative(this.uploadDir, absolutePath);
    if (!fromRoot || fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
      throw new Error('Ruta de almacenamiento privada inválida.');
    }
    return absolutePath;
  }
}
