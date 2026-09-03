import { createReadStream, mkdirSync, ReadStream } from 'fs';
import { readFile, unlink, writeFile } from 'fs/promises';
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
